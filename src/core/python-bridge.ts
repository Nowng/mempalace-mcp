import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resultText, type MemoResult, type TextChunk } from './format-result.js';

export interface BridgeConfig {
  /** Absolute (or `~`-expanded) path to the MemPalace palace directory. */
  palacePath: string;
  /** Optional storage backend override (default: config/env/detected/chroma). */
  backend?: string | null;
  /** When true, spawn the server with `--read-only`. */
  readOnly?: boolean;
}

function isWin(): boolean {
  return process.platform === 'win32';
}

/** Expand a leading `~` to the user's home directory. */
function homeDir(): string {
  const env = process.env.HOME;
  if (env && env.length > 0) return env;
  try {
    return os.userInfo().homedir;
  } catch {
    return '';
  }
}

function expandUser(p: string): string {
  if (!p) return p;
  if (p === '~') return homeDir();
  if (p[0] === '~' && (p[1] === '/' || p[1] === '\\')) {
    return homeDir().replace(/[\\/]+$/, '') + p.slice(1);
  }
  return p;
}

/**
 * Locate the directory that holds the `.venv` created by scripts/setup.cjs.
 *
 * We walk upward from this module's location (`__dirname`, available in both
 * CommonJS and the esbuild bundle) and from `process.cwd()`, because the
 * compiled layout (`dist/core/*.js`) and the bundled layout
 * (`.lmstudio/dev.js`) live at different depths relative to the project root.
 */
function findVenv(): { pyExe: string; binDir: string } | null {
  const seeds: string[] = [];
  if (typeof __dirname !== 'undefined') seeds.push(__dirname);
  try {
    seeds.push(process.cwd());
  } catch {
    /* cwd unavailable in some sandboxed contexts */
  }

  for (const seed of seeds) {
    let dir = seed;
    const root = path.parse(dir).root;
    // Guard against pathological loops.
    let guard = 0;
    while (guard++ < 40) {
      if (fs.existsSync(path.join(dir, '.venv'))) {
        const binDir = path.join(dir, '.venv', isWin() ? 'Scripts' : 'bin');
        return { pyExe: path.join(binDir, isWin() ? 'python.exe' : 'python'), binDir };
      }
      if (dir === root) break;
      dir = path.dirname(dir);
    }
  }
  return null;
}

function buildSpawnArgs(cfg: BridgeConfig): { command: string; args: string[]; env: Record<string, string> } {
  const venv = findVenv();
  if (!venv) {
    throw new Error(
      'Could not locate the .venv environment. Run `npm install` (scripts/setup.cjs) to provision MemPalace.',
    );
  }

  const args = ['-m', 'mempalace.mcp_server', '--transport', 'stdio', '--palace', expandUser(cfg.palacePath)];
  if (cfg.backend) args.push('--backend', cfg.backend);
  if (cfg.readOnly) args.push('--read-only');

  // Make the venv's `bin`/`Scripts` directory lead PATH so MemPalace's own
  // subprocess invocations resolve to the same environment.
  const sep = isWin() ? ';' : ':';
  const base: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  base.PATH = `${venv.binDir}${sep}${base.PATH ?? ''}`;

  return { command: venv.pyExe, args, env: base };
}

/**
 * A long-lived MCP *client* to the MemPalace Python stdio server.
 *
 * The wrapper never touches the Python source. It spawns
 * `python -m mempalace.mcp_server` once and reuses the JSON-RPC connection for
 * every tool call. If the configuration changes (e.g. a different palace path),
 * the stale connection is disposed and rebuilt automatically.
 */
export class PythonBridge {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private inflight: Promise<Client> | null = null;
  private current: BridgeConfig | null = null;

  private async connect(cfg: BridgeConfig): Promise<Client> {
    const spawn = buildSpawnArgs(cfg);
    const transport = new StdioClientTransport(spawn);
    this.transport = transport;
    const client = new Client(
      { name: 'mempalace-lms-bridge', version: '0.1.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
    this.client = client;
    return client;
  }

  /**
   * Ensure a connected client for the given config. Uses a single-flight promise
   * so concurrent callers share one connection, and rebuilds when the palace
   * path / backend / read-only flag changes.
   */
  async ensureConnected(cfg: BridgeConfig): Promise<Client> {
    const same =
      this.current &&
      this.current.palacePath === cfg.palacePath &&
      this.current.readOnly === cfg.readOnly &&
      this.current.backend === cfg.backend;

    if (!same) {
      await this.dispose();
      this.current = { ...cfg };
    }

    if (this.client) return this.client;
    if (!this.inflight) {
      this.inflight = this.connect(cfg).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private normalise(res: unknown): MemoResult {
    const r = (res ?? {}) as {
      content?: unknown[];
      isError?: boolean;
      toolResult?: unknown;
    };
    let content: TextChunk[] = [];
    if (Array.isArray(r.content)) {
      content = r.content
        .map((c) => {
          const text =
            c && typeof c === 'object' && 'text' in c ? String((c as { text?: unknown }).text ?? '') : '';
          return { type: 'text', text };
        })
        .filter((c) => c.text.length > 0);
    } else if (r.toolResult !== undefined) {
      content = [
        { type: 'text', text: typeof r.toolResult === 'string' ? r.toolResult : JSON.stringify(r.toolResult) },
      ];
    }
    return { content, isError: Boolean(r.isError) };
  }

  /** Call a single MemPalace tool and return its normalised result. */
  async callTool(cfg: BridgeConfig, name: string, args: Record<string, unknown>): Promise<MemoResult> {
    try {
      const client = await this.ensureConnected(cfg);
      return this.normalise(await client.callTool({ name, arguments: args }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Surface a clean error rather than throwing so the tool layer stays robust.
      return { content: [{ type: 'text', text: `MemPalace tool "${name}" failed: ${message}` }], isError: true };
    }
  }

  /** Human-readable text of a tool result (best for the model). */
  async callToolText(cfg: BridgeConfig, name: string, args: Record<string, unknown>): Promise<string> {
    return resultText(await this.callTool(cfg, name, args));
  }

  /** List the tools exposed by the live server (used for debugging/tests). */
  async listTools(cfg: BridgeConfig): Promise<unknown> {
    const client = await this.ensureConnected(cfg);
    const res = await client.listTools();
    return (res as { tools?: unknown }).tools;
  }

  /** Tear down the current connection (e.g. when config changes). */
  async dispose(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.current = null;
    if (client && transport) {
      try {
        await transport.close();
      } catch {
        /* ignore close errors during teardown */
      }
    }
  }
}

/** Process-wide singleton bridge instance. */
export const pythonBridge = new PythonBridge();
