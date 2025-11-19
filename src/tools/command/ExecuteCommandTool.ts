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
  env?: Record<string, string>;
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

Example usage with custom environment variables:
\`\`\`json
{
  "shell": "powershell",
  "command": "python -c \\"print('Hello 世界')\\"",
  "env": {
    "PYTHONIOENCODING": "utf-8",
    "PYTHONUTF8": "1"
  }
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
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Custom environment variables for command execution (optional). Example: {"PYTHONIOENCODING": "utf-8"}'
        }
      },
      required: ['shell', 'command']
    };
  }

  async execute(args: ExecuteCommandArgs): Promise<ToolResult> {
    const { shell, command, workingDir, timeout, env } = args;

    // Get services
    const securityManager = this.getService<SecurityManager>('SecurityManager');
    const commandExecutor = this.getService<CommandExecutor>('CommandExecutor');
    const historyManager = this.getService<HistoryManager>('HistoryManager');

    try {
      // Stage 1-6: Multi-stage validation (includes env var validation)
      securityManager.validateCommand(shell, command, env);

      // Execute command with environment variables
      const result = await commandExecutor.execute({
        shell,
        command,
        workingDir,
        timeout,
        env
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

      // Determine if this is a validation (-2) or execution (-1) error
      const isValidationError = errorMessage.includes('blocked') ||
                                errorMessage.includes('exceeds') ||
                                errorMessage.includes('not in allowed paths') ||
                                errorMessage.includes('operator') ||
                                errorMessage.includes('Environment variable');
      const exitCode = isValidationError ? -2 : -1;

      // Log failed command to history
      if (historyManager.isEnabled()) {
        historyManager.add({
          command,
          output: errorMessage,
          timestamp: new Date().toISOString(),
          exitCode
        });
      }

      // Create structured error based on error type
      let structured = undefined;

      if (isValidationError) {
        // Validation error - provide diagnostic guidance
        if (errorMessage.includes('blocked command')) {
          const commandMatch = errorMessage.match(/command:\s*(\S+)/i);
          const blockedCmd = commandMatch ? commandMatch[1] : 'unknown';

          structured = this.createStructuredError(
            'command_blocked',
            'SEC001',
            {
              blocked_command: blockedCmd,
              command: command,
              shell: shell
            },
            `The command "${blockedCmd}" is blocked by security policy. Either use an alternative command or modify the blockedCommands list in your config.json to allow it.`,
            'check_security_config',
            { category: 'commands' },
            'https://github.com/quanticsoul4772/mcp-server-win-cli#issue-command-is-blocked-or-command-contains-blocked-command'
          );
        } else if (errorMessage.includes('operator') || errorMessage.includes('blocked operator')) {
          const operatorMatch = errorMessage.match(/operator:\s*(.)/);
          const blockedOp = operatorMatch ? operatorMatch[1] : 'shell operator';

          structured = this.createStructuredError(
            'operator_blocked',
            'SEC002',
            {
              blocked_operator: blockedOp,
              command: command,
              shell: shell
            },
            `Shell operators (${blockedOp}) are blocked for security. Use PowerShell cmdlets or break the operation into multiple commands.`,
            'check_security_config',
            { category: 'operators' },
            'https://github.com/quanticsoul4772/mcp-server-win-cli#issue-shell-operators-blocked-pipes-redirects-command-chaining'
          );
        } else if (errorMessage.includes('not in allowed paths') || errorMessage.includes('outside allowed paths')) {
          structured = this.createStructuredError(
            'path_not_allowed',
            'SEC003',
            {
              working_dir: workingDir || process.cwd(),
              command: command
            },
            'The working directory is outside allowedPaths. Add the path to your config.json allowedPaths array, or set restrictWorkingDirectory to false (not recommended).',
            'validate_config',
            { show_merge_details: true },
            'https://github.com/quanticsoul4772/mcp-server-win-cli#issue-path-not-allowed-or-working-directory-outside-allowed-paths'
          );
        } else if (errorMessage.includes('exceeds') && !errorMessage.includes('Environment variable')) {
          structured = this.createStructuredError(
            'command_too_long',
            'SEC004',
            {
              command_length: command.length,
              max_length: 'See config'
            },
            'Command exceeds maxCommandLength. Shorten the command or increase maxCommandLength in config.json.',
            'check_security_config',
            { category: 'limits' }
          );
        } else if (errorMessage.includes('Environment variable')) {
          structured = this.createStructuredError(
            'env_var_blocked',
            'SEC005',
            {
              command: command,
              shell: shell,
              error: errorMessage
            },
            'Environment variable is blocked by security policy. Review blockedEnvVars in config.json or use check_security_config tool.',
            'check_security_config',
            { category: 'environment' }
          );
        }
      } else {
        // Execution error - provide diagnostic guidance
        if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
          structured = this.createStructuredError(
            'command_timeout',
            'EXEC001',
            {
              command: command,
              shell: shell,
              timeout: timeout || 'default'
            },
            'Command timed out. Increase the timeout parameter or the commandTimeout setting in config.json.',
            'explain_exit_code',
            { exit_code: -1 },
            'https://github.com/quanticsoul4772/mcp-server-win-cli#issue-command-times-out'
          );
        } else if (errorMessage.includes('not found') || errorMessage.includes('command not found')) {
          structured = this.createStructuredError(
            'command_not_found',
            'EXEC002',
            {
              command: command,
              shell: shell
            },
            `Command not found in ${shell}. Verify the command exists and is in PATH, or use the full path to the executable.`,
            'test_connection',
            { shell: shell, working_dir: workingDir }
          );
        } else {
          structured = this.createStructuredError(
            'execution_failed',
            'EXEC003',
            {
              command: command,
              shell: shell,
              error: errorMessage
            },
            'Command failed during execution. Check the error message for details and verify command syntax.',
            'read_command_history',
            { limit: 5 }
          );
        }
      }

      return this.error(errorMessage, exitCode, { structured });
    }
  }
}
