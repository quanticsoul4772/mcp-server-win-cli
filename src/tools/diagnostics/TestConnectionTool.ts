import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { CommandExecutor } from '../../services/CommandExecutor.js';

interface TestConnectionArgs {
  shell: 'powershell' | 'cmd' | 'gitbash';
  working_dir?: string;
}

/**
 * Tool to test basic connectivity and permissions for a shell
 *
 * Runs a safe test command to verify:
 * - Shell is accessible and functional
 * - Working directory is valid (if specified)
 * - Basic command execution works
 * - No blocking or permission issues
 *
 * Helps Claude quickly diagnose environment issues without running user commands.
 */
export class TestConnectionTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'test_connection',
      '[Diagnostics] Test shell connectivity and basic functionality',
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        shell: {
          type: 'string',
          enum: ['powershell', 'cmd', 'gitbash'],
          description: 'Shell to test (powershell, cmd, or gitbash)'
        },
        working_dir: {
          type: 'string',
          description: 'Optional working directory to test access'
        }
      },
      required: ['shell']
    };
  }

  async execute(args: TestConnectionArgs): Promise<ToolResult> {
    const executor = this.getService<CommandExecutor>('CommandExecutor');

    // Define safe test commands for each shell
    const testCommands: Record<string, string> = {
      powershell: 'Write-Output "test"',
      cmd: 'echo test',
      gitbash: 'echo test'
    };

    const testCommand = testCommands[args.shell];
    if (!testCommand) {
      return this.error(
        `Invalid shell: ${args.shell}`,
        -1,
        {
          structured: this.createStructuredError(
            'invalid_shell',
            'TEST001',
            { shell: args.shell, valid_shells: ['powershell', 'cmd', 'gitbash'] },
            'Specify one of: powershell, cmd, or gitbash',
            'read_system_info'
          )
        }
      );
    }

    try {
      const startTime = Date.now();
      const result = await executor.execute({
        shell: args.shell,
        command: testCommand,
        workingDir: args.working_dir,
        timeout: 5
      });
      const duration = Date.now() - startTime;

      const testResult = {
        status: result.exitCode === 0 ? 'success' : 'failed',
        shell: args.shell,
        shell_works: result.exitCode === 0,
        exit_code: result.exitCode,
        working_directory: args.working_dir || process.cwd(),
        response_time_ms: duration,
        output: result.output?.trim() || '',
        diagnostics: {
          command_executed: testCommand,
          validation_passed: result.exitCode !== -2,
          execution_succeeded: result.exitCode === 0,
          expected_output: 'test',
          actual_output: result.output?.trim() || ''
        }
      };

      if (result.exitCode === 0) {
        return this.success(JSON.stringify({
          ...testResult,
          message: `✅ ${args.shell} is working correctly${args.working_dir ? ' in the specified directory' : ''}`
        }, null, 2), { exitCode: 0 });
      } else if (result.exitCode === -2) {
        return this.error(
          JSON.stringify({
            ...testResult,
            message: `❌ Test command was blocked by security validation`,
            recommendation: 'Check security config and validation rules. The test command should never be blocked.'
          }, null, 2),
          -2,
          {
            structured: this.createStructuredError(
              'test_command_blocked',
              'TEST002',
              { shell: args.shell, test_command: testCommand },
              'The safe test command was blocked by security rules. This indicates a configuration issue.',
              'check_security_config',
              { category: 'all' }
            )
          }
        );
      } else {
        return this.error(
          JSON.stringify({
            ...testResult,
            message: `❌ ${args.shell} test failed`,
            recommendation: 'The shell may not be installed, not in PATH, or the working directory is invalid.'
          }, null, 2),
          -1,
          {
            structured: this.createStructuredError(
              'shell_test_failed',
              'TEST003',
              {
                shell: args.shell,
                exit_code: result.exitCode,
                output: result.output,
                working_dir: args.working_dir
              },
              args.shell === 'gitbash'
                ? 'Git Bash may not be installed. Install Git for Windows from https://git-scm.com/download/win'
                : `${args.shell} is not available or working directory is invalid. Check shell installation and working directory path.`,
              'read_system_info'
            )
          }
        );
      }
    } catch (error) {
      return this.error(
        JSON.stringify({
          status: 'error',
          shell: args.shell,
          shell_works: false,
          message: `❌ Failed to test ${args.shell}`,
          error: error instanceof Error ? error.message : String(error),
          recommendation: 'The shell may not be installed or accessible. Check system configuration.'
        }, null, 2),
        -1,
        {
          structured: this.createStructuredError(
            'connection_test_error',
            'TEST004',
            {
              shell: args.shell,
              error: error instanceof Error ? error.message : String(error)
            },
            'Failed to execute test command. Check if the shell is installed and accessible.',
            'read_system_info'
          )
        }
      );
    }
  }
}
