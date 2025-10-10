import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { ConfigManager } from '../../services/ConfigManager.js';

interface GetConfigValueArgs {
  path: string;
  show_type?: boolean;
}

/**
 * GetConfigValueTool
 *
 * Retrieves a specific configuration value by path (dot notation).
 * Useful for inspecting effective configuration settings.
 */
export class GetConfigValueTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'get_config_value',
      `[Diagnostics] Get a specific configuration value by path (dot notation)

Example usage:
\`\`\`json
{
  "path": "security.maxCommandLength",
  "show_type": true
}
\`\`\`

Examples:
- "security.maxCommandLength"
- "shells.powershell.enabled"
- "ssh.strictHostKeyChecking"`,
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Configuration path in dot notation (e.g., "security.maxCommandLength")'
        },
        show_type: {
          type: 'boolean',
          description: 'Include value type information (default: true)',
          default: true
        }
      },
      required: ['path']
    };
  }

  async execute(args: GetConfigValueArgs): Promise<ToolResult> {
    const configManager = this.getService<ConfigManager>('ConfigManager');
    const { path, show_type = true } = args;

    try {
      // Validate path format
      if (!/^[a-zA-Z0-9_.]+$/.test(path)) {
        return this.validationError(
          `Invalid config path format: "${path}". Use dot notation (e.g., "security.maxCommandLength")`
        );
      }

      const value = configManager.getConfigValue(path);

      if (value === undefined) {
        return this.error(`Configuration path not found: ${path}`, -1);
      }

      const result: any = {
        path,
        value,
        exists: true
      };

      if (show_type) {
        result.type = Array.isArray(value) ? 'array' : typeof value;
        if (Array.isArray(value)) {
          result.length = value.length;
        }
      }

      // Add context for common paths
      const pathContext = this.getPathContext(path);
      if (pathContext) {
        result.description = pathContext;
      }

      return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to get config value: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }

  private getPathContext(path: string): string | undefined {
    const contexts: Record<string, string> = {
      'security.maxCommandLength': 'Maximum allowed characters in a command',
      'security.commandTimeout': 'Command execution timeout in seconds',
      'security.restrictWorkingDirectory': 'Whether to enforce allowed paths',
      'security.allowedPaths': 'Directories where commands can execute',
      'security.blockedCommands': 'Commands that are always blocked',
      'security.blockedArguments': 'Argument patterns that are blocked',
      'security.logCommands': 'Whether to log command history',
      'security.maxHistorySize': 'Maximum number of history entries',
      'ssh.enabled': 'Whether SSH operations are enabled',
      'ssh.strictHostKeyChecking': 'SSH host key verification mode',
      'shells.powershell.enabled': 'PowerShell availability',
      'shells.cmd.enabled': 'CMD availability',
      'shells.gitbash.enabled': 'Git Bash availability'
    };

    return contexts[path];
  }
}
