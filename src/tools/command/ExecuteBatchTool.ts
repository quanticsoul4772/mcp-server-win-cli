import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { CommandExecutor } from '../../services/CommandExecutor.js';

interface ExecuteBatchArgs {
  shell: 'powershell' | 'cmd' | 'gitbash';
  commands: string[];
  stopOnError?: boolean;
  timeout?: number;
}

/**
 * ExecuteBatchTool
 *
 * Execute multiple commands sequentially in the same shell session.
 * Supports stop-on-error mode and per-command result tracking.
 */
export class ExecuteBatchTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'execute_batch',
      `[Command Execution] Execute multiple commands sequentially

Example usage:
\`\`\`json
{
  "shell": "powershell",
  "commands": [
    "cd C:\\\\project",
    "npm install",
    "npm run build"
  ],
  "stopOnError": true,
  "timeout": 300
}
\`\`\`

Executes commands in order. If stopOnError=true, stops on first failure.`,
      'Command Execution'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        shell: {
          type: 'string',
          enum: ['powershell', 'cmd', 'gitbash'],
          description: 'Shell to use for command execution'
        },
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of commands to execute sequentially',
          minItems: 1,
          maxItems: 10
        },
        stopOnError: {
          type: 'boolean',
          description: 'Stop execution if a command fails (default: true)',
          default: true
        },
        timeout: {
          type: 'number',
          description: 'Timeout per command in seconds (default: 60)',
          default: 60
        }
      },
      required: ['shell', 'commands']
    };
  }

  async execute(args: ExecuteBatchArgs): Promise<ToolResult> {
    const { shell, commands, stopOnError = true, timeout = 60 } = args;

    try {
      // Validate
      if (commands.length === 0) {
        return this.validationError('Commands array cannot be empty');
      }

      if (commands.length > 10) {
        return this.validationError('Maximum 10 commands allowed per batch');
      }

      if (timeout < 1 || timeout > 600) {
        return this.validationError('Timeout must be between 1 and 600 seconds');
      }

      const commandExecutor = this.getService<CommandExecutor>('CommandExecutor');
      const results: any[] = [];
      let overallSuccess = true;

      // Execute commands sequentially
      for (let i = 0; i < commands.length; i++) {
        const command = commands[i];
        const startTime = Date.now();

        try {
          const execResult = await commandExecutor.execute({
            shell,
            command,
            timeout
          });

          const commandResult = {
            index: i,
            command,
            exitCode: execResult.exitCode,
            output: execResult.output,
            duration: Date.now() - startTime,
            status: execResult.exitCode === 0 ? 'success' : 'failed'
          };

          results.push(commandResult);

          // Stop on error if enabled
          if (stopOnError && execResult.exitCode !== 0) {
            overallSuccess = false;
            break;
          }

          if (execResult.exitCode !== 0) {
            overallSuccess = false;
          }
        } catch (error) {
          const commandResult = {
            index: i,
            command,
            exitCode: -1,
            output: `Error: ${error instanceof Error ? error.message : String(error)}`,
            duration: Date.now() - startTime,
            status: 'error'
          };

          results.push(commandResult);
          overallSuccess = false;

          if (stopOnError) {
            break;
          }
        }
      }

      const result = {
        shell,
        totalCommands: commands.length,
        executedCommands: results.length,
        successCount: results.filter(r => r.exitCode === 0).length,
        failedCount: results.filter(r => r.exitCode !== 0).length,
        overallSuccess,
        stopOnError,
        results,
        timestamp: new Date().toISOString()
      };

      return this.success(JSON.stringify(result, null, 2), {
        exitCode: overallSuccess ? 0 : -1
      });
    } catch (error) {
      return this.error(
        `Batch execution failed: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
