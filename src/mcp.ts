import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { catalog } from './core/tools-catalog.js';
import { pythonBridge, type BridgeConfig } from './core/python-bridge.js';
import { jsonSchemaToZod } from './core/zod-from-json.js';

function resolveConfig(): BridgeConfig {
  return {
    palacePath: process.env.MEMPALACE_PALACE_PATH || '~/.mempalace/palace',
    readOnly: (process.env.MEMPALACE_MCP_READ_ONLY || '').toLowerCase() === '1',
  };
}

/**
 * Standalone MCP server that proxies to the MemPalace Python server.
 *
 * All 45 tools are registered from the shared catalog, so `tools/list` returns
 * them without needing a live Python connection. The Python server is only
 * spawned (lazily, and cached) when an actual tool is called.
 *
 * Launch: `node dist/mcp.js` (see package.json "mcp" script / bin entry).
 */
async function main(): Promise<void> {
  const server = new McpServer(
    { name: 'mempalace-mcp-lms', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  for (const entry of catalog) {
    server.registerTool(entry.name, {
      description: entry.description,
      inputSchema: jsonSchemaToZod(entry.inputSchema).shape,
    }, async (args) => {
      try {
        const cfg = resolveConfig();
        const result = await pythonBridge.callTool(cfg, entry.name, args ?? {});
        return {
          content: result.content.map((c: { text: string }) => ({ type: 'text', text: c.text })),
          isError: Boolean(result.isError),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error calling ${entry.name}: ${message}` }],
          isError: true,
        };
      }
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Diagnostics go to stderr so stdout stays pure MCP JSON-RPC.
  console.error('mempalace-mcp-lms: running on stdio (MemPalace bridge spawned lazily per tool call).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
