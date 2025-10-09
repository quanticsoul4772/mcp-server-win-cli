import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { CommandExecutor, CommandExecutionOptions } from '../../services/CommandExecutor.js';
import type { SecurityManager } from '../../services/SecurityManager.js';
import type { HistoryManager } from '../../services/HistoryManager.js';
import type { ConfigManager } from '../../services/ConfigManager.js';
import type { ServerConfig } from '../../types/config.js';

interface ExecuteCommandArgs {
  shell: keyof ServerConfig['shells'];
  command: string;
  workingDir?: string;
  timeout?: number;
}

/**
 * ExecuteCommandTool
 *
 * Executes shell commands with comprehensive validation and history tracking.
 * Supports PowerShell, CMD, and Git Bash shells.
 */
export class ExecuteCommandTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'execute_command',
      `[Command Execution] Execute a command in the specified shell (powershell, cmd, or gitbash)

Example usage (PowerShell):
\`\`\`json
{
  "shell": "powershell",
  "command": "Get-Process | Select-Object -First 5",
  "workingDir": "C:\\\\Users\\\\username"
}
\`\`\`

Example usage (CMD):
\`\`\`json
{
  "shell": "cmd",
  "command": "dir /b",
  "workingDir": "C:\\\\Projects"
}
\`\`\`

Example usage (Git Bash):
\`\`\`json
{
  "shell": "gitbash",
  "command": "ls -la",
  "workingDir": "/c/Users/username"
}
\`\`\``,
      'Command Execution'
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
          description: 'Shell to use for command execution'
        },
        command: {
          type: 'string',
          description: 'Command to execute'
        },
        workingDir: {
          type: 'string',
          description: 'Working directory for command execution (optional)'
        },
        timeout: {
          type: 'number',
          description: 'Command timeout in seconds (overrides config default)'
        }
      },
      required: ['shell', 'command']
    };
  }

  async execute(args: ExecuteCommandArgs): Promise<ToolResult> {
    const { shell, command, workingDir, timeout } = args;

    // Get services
    const securityManager = this.getService<SecurityManager>('SecurityManager');
    const commandExecutor = this.getService<CommandExecutor>('CommandExecutor');
    const historyManager = this.getService<HistoryManager>('HistoryManager');

    try {
      // Stage 1-5: Multi-stage validation
      securityManager.validateCommand(shell, command);

      // Execute command
      const result = await commandExecutor.execute({
        shell,
        command,
        workingDir,
        timeout
      });

      // Log to history
      if (historyManager.isEnabled()) {
        historyManager.add({
          command,
          output: result.output + (result.error ? '\n[STDERR]\n' + result.error : ''),
          timestamp: new Date().toISOString(),
          exitCode: result.exitCode
        });
      }

      // Format result
      const formatted = commandExecutor.formatResult(result, command);

      return this.success(formatted, { exitCode: result.exitCode });
    } catch (error) {
      // Validation or execution error
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Log failed command to history (validation failures get -2, execution failures get -1)
      if (historyManager.isEnabled()) {
        const exitCode = errorMessage.includes('blocked') ||
                        errorMessage.includes('exceeds') ||
                        errorMessage.includes('not in allowed paths') ? -2 : -1;

        historyManager.add({
          command,
          output: '',
          timestamp: new Date().toISOString(),
          exitCode
        });
      }

      // Determine exit code for error response
      const exitCode = errorMessage.includes('blocked') ||
                      errorMessage.includes('exceeds') ||
                      errorMessage.includes('not in allowed paths') ? -2 : -1;

      return this.error(errorMessage, exitCode);
    }
  }
}
