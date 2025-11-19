import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { SecurityManager } from '../../services/SecurityManager.js';
import { EnvironmentManager } from '../../services/EnvironmentManager.js';

interface CheckSecurityConfigArgs {
  category?: 'all' | 'commands' | 'paths' | 'operators' | 'limits' | 'environment';
}

/**
 * CheckSecurityConfigTool
 *
 * Returns current security configuration for troubleshooting blocked commands.
 */
export class CheckSecurityConfigTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'check_security_config',
      '[Diagnostics] Get current security configuration including blocked commands, allowed paths, and restrictions. Use this to troubleshoot why commands are being blocked.',
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['all', 'commands', 'paths', 'operators', 'limits', 'environment'],
          description: 'Filter by configuration category (optional, default: all)'
        }
      },
      required: []
    };
  }

  async execute(args: CheckSecurityConfigArgs): Promise<ToolResult> {
    const category = args.category || 'all';

    try {
      const securityManager = this.getService<SecurityManager>('SecurityManager');
      const config = securityManager.getConfig();

      let result: any;

      switch (category) {
        case 'commands':
          result = {
            blockedCommands: config.blockedCommands,
            blockedArguments: config.blockedArguments
          };
          break;

        case 'paths':
          result = {
            allowedPaths: config.allowedPaths,
            restrictWorkingDirectory: config.restrictWorkingDirectory
          };
          break;

        case 'operators':
          result = {
            shells: config.shells.map(s => ({
              name: s.name,
              enabled: s.enabled,
              blockedOperators: s.blockedOperators
            }))
          };
          break;

        case 'limits':
          result = {
            maxCommandLength: config.maxCommandLength,
            commandTimeout: config.commandTimeout,
            maxCustomEnvVars: config.maxCustomEnvVars ?? EnvironmentManager.getDefaultMaxCustomEnvVars(),
            maxEnvVarValueLength: config.maxEnvVarValueLength ?? EnvironmentManager.getDefaultMaxEnvVarValueLength()
          };
          break;

        case 'environment':
          result = {
            blockedEnvVars: config.blockedEnvVars ?? EnvironmentManager.getDefaultBlockedEnvVars(),
            allowedEnvVars: config.allowedEnvVars ?? null,
            mode: config.allowedEnvVars ? 'allowlist' : 'blocklist',
            maxCustomEnvVars: config.maxCustomEnvVars ?? EnvironmentManager.getDefaultMaxCustomEnvVars(),
            maxEnvVarValueLength: config.maxEnvVarValueLength ?? EnvironmentManager.getDefaultMaxEnvVarValueLength(),
            note: config.allowedEnvVars
              ? 'Allowlist mode: ONLY variables in allowedEnvVars can be set'
              : 'Blocklist mode: variables matching blockedEnvVars patterns are blocked'
          };
          break;

        case 'all':
        default:
          result = config;
          break;
      }

      return this.success(JSON.stringify(result, null, 2));
    } catch (error) {
      return this.error(
        `Failed to retrieve security config: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
