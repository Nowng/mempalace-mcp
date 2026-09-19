import { createConfigSchematics } from '@lmstudio/sdk';

/**
 * Global configuration shared across all chats. The palace path is
 * environment/user specific, so it belongs here (not per-chat).
 */
export const globalConfigSchematics = createConfigSchematics()
  .field(
    'palacePath',
    'string',
    {
      displayName: 'Palace Path',
      subtitle:
        'Absolute path to the MemPalace palace directory (supports ~). Used by every tool.',
    },
    '~/.mempalace/palace',
  )
  .field(
    'readOnly',
    'boolean',
    {
      displayName: 'Read-only mode',
      subtitle:
        'When enabled, the MemPalace server is spawned with --read-only and mutating tools are refused.',
    },
    false,
  )
  .build();

/**
 * Per-chat configuration. This plugin does not require per-chat settings, but
 * an empty schema is exported so host applications that expect it still work.
 */
export const configSchematics = createConfigSchematics().build();
