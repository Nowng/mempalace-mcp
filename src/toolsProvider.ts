import { tool, Tool, ToolsProviderController } from '@lmstudio/sdk';
import { catalog } from './core/tools-catalog.js';
import { pythonBridge, type BridgeConfig } from './core/python-bridge.js';
import { globalConfigSchematics } from './config.js';
import { jsonSchemaToZod } from './core/zod-from-json.js';

const DEFAULT_PALACE_PATH = '~/.mempalace/palace';

function resolveConfig(ctl: ToolsProviderController): BridgeConfig {
  const config = ctl.getPluginConfig(globalConfigSchematics);
  return {
    palacePath: String(config.get('palacePath') || DEFAULT_PALACE_PATH),
    readOnly: Boolean(config.get('readOnly')),
  };
}

/**
 * LM Studio Plugin tool provider. Exposes every MemPalace MCP tool (all 45) as
 * a native LM Studio tool. Each tool forwards to the long-lived Python bridge,
 * so the original Python source is never modified and stays git-pull updatable.
 */
export async function toolsProvider(ctl: ToolsProviderController): Promise<Tool[]> {
  return catalog.map((entry) =>
    tool({
      name: entry.name,
      description: entry.description,
      parameters: jsonSchemaToZod(entry.inputSchema).shape,
      implementation: async (args) => {
        try {
          const cfg = resolveConfig(ctl);
          return await pythonBridge.callToolText(cfg, entry.name, args ?? {});
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error calling ${entry.name}: ${message}`;
        }
      },
    }),
  );
}
