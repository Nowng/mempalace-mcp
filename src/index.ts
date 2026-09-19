import { type PluginContext } from '@lmstudio/sdk';
import { toolsProvider } from './toolsProvider.js';
import { configSchematics, globalConfigSchematics } from './config.js';

/**
 * LM Studio Plugin entry point.
 *
 * `lms dev` / the Hub load this module and call `main(pluginContext)`. Here we
 * register the MemPalace tool surface (all 45 MCP tools) as a native tools
 * provider plus the global configuration schematics (Palace Path, Read-only).
 */
export async function main(pluginContext: PluginContext): Promise<void> {
  pluginContext
    .withToolsProvider(toolsProvider)
    .withGlobalConfigSchematics(globalConfigSchematics)
    .withConfigSchematics(configSchematics);
}

/* Also re-export for direct/testing imports and the standalone MCP entry. */
export { toolsProvider };
