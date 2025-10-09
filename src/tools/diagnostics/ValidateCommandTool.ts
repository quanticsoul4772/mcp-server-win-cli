import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { SecurityManager } from '../../services/SecurityManager.js';
import type { ConfigManager } from '../../services/ConfigManager.js';
import type { ServerConfig } from '../../types/config.js';

interface ValidateCommandArgs {
  shell: keyof ServerConfig['shells'];
  command: string;
  workingDir?: string;
}

/**
 * ValidateCommandTool
 *
 * Tests if a command would be allowed without executing it (dry-run validation).
 * Useful for troubleshooting security blocks before attempting execution.
 */
export class ValidateCommandTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'validate_command',
      '[Diagnostics] Test if a command would be allowed without executing it (dry-run validation). Use this to troubleshoot security blocks before attempting execution.',
      'Diagnostics'
    );
  }

  getInputSchema() {
    const configManager = this.getService<ConfigManager>('ConfigManager');
    const enabledShells = configManager.getEnabledShells();

    return {
      type: 'object',
      properties: {
        shell: {
          type: 'string',
          enum: enabledShells,
          description: 'Shell to validate against'
        },
        command: {
          type: 'string',
          description: 'Command to validate'
        },
        workingDir: {
          type: 'string',
          description: 'Working directory to validate (optional)'
        }
      },
      required: ['shell', 'command']
    };
  }

  async execute(args: ValidateCommandArgs): Promise<ToolResult> {
    const { shell, command, workingDir } = args;

    try {
      const securityManager = this.getService<SecurityManager>('SecurityManager');

      // Attempt validation (will throw if validation fails)
      securityManager.validateCommand(shell, command);

      // If we reach here, validation passed
      const result = {
        valid: true,
        shell,
        command,
        workingDir: workingDir || 'default (current directory)',
        message: 'Command passed all security validation stages'
      };

      return this.success(JSON.stringify(result, null, 2));
    } catch (error) {
      // Validation failed - this is expected behavior for dry-run
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Determine what type of validation failed and provide guidance
      let guidance = '';
      let suggestedTool = 'check_security_config';
      let suggestedArgs: Record<string, any> = {};

      if (errorMessage.includes('blocked command')) {
        guidance = 'Command is blocked. Check the blockedCommands list in your configuration.';
        suggestedArgs = { category: 'commands' };
      } else if (errorMessage.includes('operator') || errorMessage.includes('blocked operator')) {
        guidance = 'Shell operators are blocked. Use PowerShell cmdlets or break into multiple commands.';
        suggestedArgs = { category: 'operators' };
      } else if (errorMessage.includes('not in allowed paths') || errorMessage.includes('outside allowed paths')) {
        guidance = 'Working directory is outside allowedPaths. Add the path to your config or disable restrictWorkingDirectory.';
        suggestedTool = 'validate_config';
        suggestedArgs = { show_merge_details: true };
      } else if (errorMessage.includes('exceeds')) {
        guidance = 'Command exceeds maxCommandLength. Shorten the command or increase the limit.';
        suggestedArgs = { category: 'limits' };
      } else if (errorMessage.includes('argument')) {
        guidance = 'Command contains blocked arguments. Check the blockedArguments list in your configuration.';
        suggestedArgs = { category: 'commands' };
      } else {
        guidance = 'Command failed validation. Check security settings.';
        suggestedArgs = { category: 'all' };
      }

      const result = {
        valid: false,
        shell,
        command,
        workingDir: workingDir || 'default (current directory)',
        reason: errorMessage,
        guidance,
        next_steps: {
          recommended_tool: suggestedTool,
          tool_args: suggestedArgs,
          why: 'This tool will show you the specific security rules that are blocking your command.'
        }
      };

      // Return as success (the validation itself succeeded, the command just wouldn't be allowed)
      return this.success(JSON.stringify(result, null, 2));
    }
  }
}
