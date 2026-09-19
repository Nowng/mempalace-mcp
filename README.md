# mempalace-mcp

A lightweight **LM Studio Plugin** wrapper around the
[MemPalace](https://github.com/MemPalace/mempalace) MCP server. It re-exposes
**all 45 MemPalace MCP tools** in two complementary ways, without ever editing
the original Python source tree (so `git pull` inside `MemPalace/` keeps working):

1. As a native **LM Studio Plugin tools provider** — usable directly inside LM
   Studio's tool-calling loop (`src/toolsProvider.ts`).
2. As a standalone **MCP server** — connectable from any MCP client, including
   Claude Code, Gemini CLI, Cursor, and Antigravity (`dist/mcp.js`, see
   `npm run mcp`).

Both entry points share one catalog (`src/core/tools-catalog.ts`) and one
long-lived bridge (`src/core/python-bridge.ts`). The TypeScript layer is purely
a thin, type-safe proxy in front of the real Python server.

> **Bottom line:** you write nothing about MemPalace's internals here. The
> wrapper only *spawns*, *talks*, and *forwards*. MemPalace stays the source of
> truth and stays updatable.

---

## What MemPalace is

MemPalace is a **local-first AI memory** store. It keeps your conversation
history as **verbatim text** and retrieves it with semantic search — it does
not summarize, extract, or paraphrase. The index is structured: people and
projects become *wings*, topics become *rooms*, and original content lives in
*drawers*. Retrieval is pluggable (ChromaDB by default) and nothing leaves your
machine unless you opt in.

`mempalace-mcp` simply makes that palace reachable from LM Studio and any other
MCP client through a consistent 45-tool surface.

---

## Architecture

```
            LM Studio Plugin tool loop          Any MCP client
                        │                              │
                        └──────────┬───────────────────┘
                                     │
                   ┌────────────────▼─────────────────┐
                   │  src/index.ts  →  main(context)   │  (registers both)
                   └───────────────┬──────────────────┘
                     ┌──────────────┴──────────────┐
                     ▼                              ▼
        src/toolsProvider.ts              src/mcp.ts
   (LM Studio Tool API, zod params)   (standalone MCP server)
                     │                              │
                     └───────────────┬──────────────┘
                                     │
                    src/core/tools-catalog.ts   ← single source of truth
                    (name + description + JSON schema for all 45 tools)
                                     │
                    src/core/python-bridge.ts
                    (spawns the Python server once, reuses the connection)
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                                ▼
        python -m mempalace.mcp_server         MemPalace palace
        (stdio JSON-RPC, unmodified)       (ChromaDB / SQLite / KG / logstream)
```

Key design decisions:

| Concern | Decision | Why |
|---|---|---|
| Tool definitions | Transcribed verbatim from Python `schemas.py` `TOOLS` into `tools-catalog.ts` | One source of truth for both entry points; re-derivable on demand. |
| Talking to Python | A persistent MCP **client** over stdio (`python-bridge.ts`) | One spawn reused across calls instead of spawning per tool. |
| Parameter typing | Each tool's JSON schema is mapped to a Zod schema (`zod-from-json.ts`) | Type safety + automatic `inputSchema` for both the LM Studio and MCP surfaces. |
| Python environment | Provisioned by `scripts/setup.cjs` at `postinstall` | Keeps `MemPalace/` a clean git checkout you can update. |
| Palace path / read-only | Configured via Plugin global config, passed to the Python server at spawn time | No secrets baked into source; per-user palace location. |

---

## Repository layout

```
mempalace-mcp/
├── manifest.json            # LM Studio Plugin manifest (owner kebab-case)
├── package.json             # deps, scripts ("postinstall" provisions the venv), bin
├── tsconfig.json            # NodeNext ESM-style TS → compiled to dist/
├── README.md
├── scripts/
│   └── setup.cjs            # postinstall: clone + venv + pip install MemPalace
├── src/
│   ├── index.ts             # Plugin entry → exports main(pluginContext)
│   ├── toolsProvider.ts     # LM Studio tool provider (all 45 tools)
│   ├── config.ts            # Global config schematics (Palace Path, Read-only)
│   ├── mcp.ts               # Standalone MCP server entry (npm run mcp)
│   └── core/
│       ├── python-bridge.ts # Spawns + talks to the Python MCP server
│       ├── tools-catalog.ts # Authoritative list of all 45 tools
│       ├── zod-from-json.ts # JSON schema → Zod conversion
│       └── format-result.ts # Result shaping for both surfaces
└── dist/                    # Compiled JavaScript (output of `npm run build`)
```

---

## Development process

This project was built as a **port**, not a rewrite. The steps that mattered:

1. **Enumerate the source of truth.** The Python server declares every tool in
   `MemPalace/mempalace/mcp_server/schemas.py` (`TOOLS`). We transcribed each
   tool's name, description, and JSON schema verbatim into
   `src/core/tools-catalog.ts`. Nothing is hand-rolled per tool.
2. **Wrap, don't reimplement.** Rather than translate the MCP protocol by hand,
   `python-bridge.ts` uses `@modelcontextprotocol/sdk` as an MCP **client** and
   spawns `python -m mempalace.mcp_server` once, reusing that connection. The
   wrapper only forwards arguments and shapes results.
3. **Share one catalog across two entry points.** `toolsProvider.ts` (LM
   Studio) and `mcp.ts` (standalone MCP) iterate the same catalog, so the two
   surfaces can never drift apart.
4. **Keep the Python tree pristine.** `MemPalace/` is a git clone managed by
   `scripts/setup.cjs`. We never edit it, so upstream fixes and new tools land
   through a plain `git pull` and this catalog can be regenerated.
5. **Provision at install time.** The `postinstall` script clones MemPalace,
   builds a Python venv, and installs the package (plus `chromadb`, `numpy`,
   `onnxruntime`, …) into it — so `npm install` leaves a working palace behind.

> The plugin is **CommonJS** on purpose: `lms dev`/Hub bundles it with esbuild
> as CJS, so the package must load as CJS too. The source therefore uses
> `__dirname` (not `import.meta`) to locate `.venv`, and the entry exports a
> `main(pluginContext)` function that `lms` invokes to register the provider.

---

## Installation

### From the LM Studio Hub (recommended)

Once published, install straight from the Hub. On first load, npm runs the
`postinstall` hook, which:

1. clones `https://github.com/MemPalace/mempalace` into `MemPalace/`,
2. creates a Python venv at `.venv/`,
3. runs `pip install -e ./MemPalace` to provision the palace + deps.

Then open **Plugins → mempalace-mcp**, enable it, and set **Palace Path** in its
global configuration. The first tool call spawns the Python server; the
connection is cached for subsequent calls.

### From a source checkout

```bash
npm install                 # runs postinstall: clone + venv + pip install
npm run typecheck           # tsc --noEmit
npm run build               # tsc → dist/
lms dev                     # load into LM Studio (hot-reload)
lms push                    # publish to the Hub
```

`npm install` alone is not proof that MCP is connected — see *Verifying the
connection* below.

---

## The 45 MCP tools

Every tool mirrors its Python counterpart exactly. They fall into eight groups.

### Overview (7)
| Tool | Purpose |
|---|---|
| `mempalace_status` | Palace overview — total drawers, wing/room counts |
| `mempalace_list_wings` | List all wings with drawer counts |
| `mempalace_list_rooms` | List rooms within a wing (or all rooms) |
| `mempalace_get_taxonomy` | Full wing → room → count tree |
| `mempalace_get_aaak_spec` | The AAAK compressed-memory dialect spec |
| `mempalace_graph_stats` | Graph overview: rooms, tunnels, edges |
| `mempalace_mesh_peers` | Shared-brain replica/mesh estate snapshot (RFC 004) |

### Graph navigation (8)
`mempalace_traverse`, `mempalace_find_tunnels`, `mempalace_create_tunnel`,
`mempalace_list_tunnels`, `mempalace_delete_tunnel`, `mempalace_list_hallways`,
`mempalace_delete_hallway`, `mempalace_follow_tunnels`

### Search & read drawers (4)
`mempalace_search`, `mempalace_check_duplicate`, `mempalace_get_drawer`,
`mempalace_list_drawers`

### Write drawers (7)
`mempalace_add_drawer`, `mempalace_update_drawer`, `mempalace_delete_drawer`,
`mempalace_delete_by_source`, `mempalace_mine`, `mempalace_checkpoint`,
`mempalace_sync`

### Knowledge graph (6)
`mempalace_kg_query`, `mempalace_kg_add`, `mempalace_kg_invalidate`,
`mempalace_kg_supersede`, `mempalace_kg_timeline`, `mempalace_kg_stats`

### Diary (4)
`mempalace_diary_write`, `mempalace_diary_read`, `mempalace_hook_settings`,
`mempalace_memories_filed_away`

### Coordination — logstream & artifacts (RFC 003/004) (8)
`mempalace_event_append`, `mempalace_task_create`, `mempalace_event_list`,
`mempalace_event_wait`, `mempalace_event_ack`, `mempalace_artifact_put`,
`mempalace_artifact_get`, `mempalace_patch_submit`

### Maintenance (1)
`mempalace_reconnect` — force a reconnect to the palace DB after external writes.

> Need the exact argument schema for a tool? It is defined in
> `src/core/tools-catalog.ts` and validated by Zod on both surfaces.

---

## Usage

### 1. Inside LM Studio (Plugin)

Enable the plugin, set **Palace Path** (and optionally **Read-only mode**) in its
global config, then let the model call tools during a session. The provider
registers all 45 tools automatically; the model sees their descriptions and can
invoke any of them.

### 2. As a standalone MCP server

Add it to any MCP client via stdio:

```json
{
  "mcpServers": {
    "mempalace-mcp-lms": {
      "command": "node",
      "args": ["/absolute/path/to/project/dist/mcp.js"]
    }
  }
}
```

Or run it directly and talk to it over stdio:

```bash
npm run build && npm run mcp
```

`mcp.ts` reads `MEMPALACE_PALACE_PATH` / `MEMPALACE_MCP_READ_ONLY` from the
environment when no explicit config is supplied.

### Verifying the connection

Package installation alone does **not** prove MCP is connected. Confirm the live
tool list:

```bash
# standalone
node dist/mcp.js            # then call tools/list over stdio
# or, inside LM Studio, open the tool panel and confirm all 45 tools appear
```

The first call spawns `python -m mempalace.mcp_server`; a healthy response
(`mempalace_status` returning counts, or a graceful "no palace yet" message)
means the bridge is wired correctly.

---

## Using MemPalace's own examples & skills through mempalace-mcp

MemPalace ships **examples** and **skills** that describe how agents should set
up, recall from, and coordinate via the palace. `mempalace-mcp` is the transport
that lets your agent actually *execute* those patterns — whether you run them in
LM Studio or through another MCP harness. The sections below map each upstream
resource to the concrete tool calls it triggers.

### `MemPalace/examples/` — runnable recipes & wiring guides

| File | What it shows | Tool surface used |
|---|---|---|
| `basic_mining.py` | Mine a project folder: init → mine → search | `mempalace_mine`, `mempalace_search`, `mempalace_status` |
| `convo_import.py` | Import Claude Code / ChatGPT transcripts (`--mode convos`) | `mempalace_mine` (with `mode="convos"`) |
| `mx3_public_shim_embeddings_rerank.py` (+`.md`) | Route Chroma embeddings + post-retrieval rerank through a local MX3 public-shim endpoint (opt-in, hardware-backed) | `mempalace_search` after env-var configuration |
| `antigravity/` (`README.md`, `hooks.json`, `mcp_config.json`) | Wire MemPalace into the Antigravity CLI over MCP | `{ "mcpServers": { "mempalace": { "command": "mempalace-mcp" } } }` |
| `cursor/` (`README.md`, `hooks.json`, `rules/*.mdc`) | Cursor IDE hooks + recall rules that run before context compression | auto-save hooks → `mempalace_checkpoint` / `mempalace_diary_write` |
| `gemini_cli_setup.md` | Set up MemPalace from the Gemini CLI | MCP stdio registration |
| `mcp_setup.md` | Minimal Claude Code MCP integration (`claude mcp add mempalace -- mempalace-mcp`) | live tool list (`mempalace_status`, `mempalace_search`, `mempalace_list_wings`) |
| `HOOKS_TUTORIAL.md` | Auto-save hook configuration across harnesses | hook-driven writes to the palace |

**How to use them with `mempalace-mcp`:**

- **Mine a project first.** Point `mempalace_mine` at the directory you want the
  agent to remember (code, docs, or transcripts). For Claude Code sessions:
  `mempalace_mine` with `mode="convos"` over your `~/.claude/projects/` tree — the
  shape matches `convo_import.py`.
- **Search before answering.** Run `mempalace_search` with a short, keyword-only
  `query` (≤ 250 chars — never paste a whole conversation or system prompt). Use
  `wing` / `room` filters to scope, and `limit` (default 5) to bound results.
- **Prefer the MX3 shim only on backed hardware.** The `mx3_public_shim` recipe
  is opt-in and requires the accelerator behind the endpoint; enable it via the
  documented `MEMPALACE_MX3_PUBLIC_SHIM_*` env vars, then call `mempalace_search`
  as usual.

### `MemPalace/skills/` — agent runbooks

MemPalace exposes three **skills** (agent-runbook markdown consumed by coding
agents). `mempalace-mcp` is the MCP surface each skill assumes is connected.

- **`skills/mempalace/SKILL.md` — Install, configure, and operate.** Guided
  setup for a private local palace, a shared-brain hub, or a client joining an
  existing hub. Covers detecting the harness, choosing topology, configuring MCP,
  and reporting readiness. Through `mempalace-mcp` this becomes: spawn the Python
  server, verify `tools/list` shows the 45 tools, then operate via
  `mempalace_status`, `mempalace_mine`, `mempalace_list_wings`, etc.

- **`skills/mempalace-recall/SKILL.md` — Search-before-answer recall.** The core
  agent discipline: read the palace instead of guessing from model memory. Key
  mappings through `mempalace-mcp`:
  - Wake-up: call `mempalace_search`; use `mempalace_kg_query` for relational or
    time-bound facts (`as_of`).
  - Always return the drawer's **verbatim** text — never summarize stored content.
  - Record continuity with `mempalace_diary_write`; when a fact changes, use
    `mempalace_kg_supersede` (single-valued replacement), `mempalace_kg_invalidate`
    (ended without replacement), or `mempalace_kg_add` (independent/coexisting).
  - **Anti-patterns to enforce:** don't search on greenfield tasks with no memory
    relevance, don't answer from model memory when the palace might know, and
    don't paraphrase what `mempalace_search` returns.

- **`skills/mempalace-task/SKILL.md` — Logstream task delegation.** Move work
  *between agents* via the logstream (not memory drawers). Through `mempalace-mcp`:
  - Create a handoff with `mempalace_task_create` (returns a ready-to-paste line).
  - Monitor the inbox with `mempalace_event_list` / `mempalace_event_wait`,
    carrying `since_event_id` forward as a resume cursor.
  - Claim with `mempalace_event_ack(status="claimed")`, deliver patches via
    `mempalace_patch_submit`, and reference stored files with
    `mempalace_artifact_put` / `mempalace_artifact_get`.
  - Remember: logstream events are immutable — show the user the exact task
    content and get approval before appending.

### Recommended workflow (any harness)

1. **Set up** — follow `skills/mempalace/SKILL.md`; confirm the 45 tools are live.
2. **Mine** — `mempalace_mine` your corpus (code, convos, or office docs).
3. **Recall** — follow `skills/mempalace-recall/SKILL.md`: search first, quote
   verbatim, write diary continuity with `mempalace_diary_write`.
4. **Coordinate** — when delegating across agents, switch to
   `skills/mempalace-task/SKILL.md` and the logstream tools.

---

## Requirements

- Python 3.9+ (provisioned automatically into `.venv/` by `scripts/setup.cjs`).
- A vector-store backend — ChromaDB is bundled and needs no configuration.
- ~300 MB disk for the embedding model. The first embedding-backed call downloads
  the model (~80 MB default `minilm`, ~300 MB `embeddinggemma`); read-only
  sqlite-backed tools (`mempalace_status`, list, taxonomy, KG) stay fast.
- Optional: route embeddings/rerank through an OpenAI-compatible endpoint by
  setting `embedding_model: "openai-compat"` in MemPalace's config — no content
  leaves your network when the endpoint is local.

No API key is required for the core recall path.

---

## Notes & limitations

- **Python is required at install and runtime.** The bridge spawns the venv's
  Python. On machines where `python3` on PATH is a broken symlink (empty
  `sys.executable`), `setup.cjs` falls back to absolute interpreter paths under
  `/usr/bin/python3.*`.
- **First embedding-backed call is slow and needs network.** The embedder model
  downloads once per palace; subsequent calls are fast.
- **Read-only mode** spawns the Python server with `--read-only`; mutating tools
  (writes, mine, checkpoint, coordination) are refused, which is useful for
  pure recall sessions.

---

## References

- MemPalace repo: <https://github.com/MemPalace/mempalace>
- Full MCP tool reference: <https://mempalaceofficial.com/reference/mcp-tools.html>
- The palace concept: <https://mempalaceofficial.com/concepts/the-palace.html>
- Knowledge graph: <https://mempalaceofficial.com/concepts/knowledge-graph>

---

## Contributing

PRs welcome. When adding or renaming a tool, update `src/core/tools-catalog.ts`
to match `MemPalace/mempalace/mcp_server/schemas.py` so both entry points stay
in sync.

## License

MIT — see [LICENSE](LICENSE).
