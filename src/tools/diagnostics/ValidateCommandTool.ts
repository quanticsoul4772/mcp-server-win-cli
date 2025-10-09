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
      const result = {
        valid: false,
        shell,
        command,
        workingDir: workingDir || 'default (current directory)',
        reason: error instanceof Error ? error.message : String(error)
      };

      // Return as success (the validation itself succeeded, the command just wouldn't be allowed)
      return this.success(JSON.stringify(result, null, 2));
    }
  }
}
