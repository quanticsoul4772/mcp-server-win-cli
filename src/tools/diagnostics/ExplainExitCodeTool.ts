import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';

interface ExplainExitCodeArgs {
  exit_code: number;
}

interface ExitCodeExplanation {
  meaning: string;
  description: string;
  user_action: string;
  diagnostic_tools?: string[];
  common_causes?: string[];
  help_url?: string;
}

/**
 * Tool to explain exit codes and provide troubleshooting guidance
 *
 * Helps Claude understand what exit codes mean and guide users to fix issues.
 * Exit codes:
 * - 0: Success
 * - -1: Execution failure (process error, timeout)
 * - -2: Validation failure (blocked by security)
 * - Other: Process-specific exit codes
 */
export class ExplainExitCodeTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'explain_exit_code',
      '[Diagnostics] Explain what an exit code means and how to resolve issues',
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        exit_code: {
          type: 'number',
          description: 'Exit code to explain (e.g., 0, -1, -2, or process-specific codes)'
        }
      },
      required: ['exit_code']
    };
  }

  async execute(args: ExplainExitCodeArgs): Promise<ToolResult> {
    const explanation = this.getExplanation(args.exit_code);

    return this.success(JSON.stringify({
      exit_code: args.exit_code,
      ...explanation
    }, null, 2), { exitCode: 0 });
  }

  private getExplanation(exitCode: number): ExitCodeExplanation {
    const explanations: Record<number, ExitCodeExplanation> = {
      0: {
        meaning: 'Success',
        description: 'Command executed successfully with no errors.',
        user_action: 'No action needed. The command completed successfully.',
        help_url: 'https://github.com/quanticsoul4772/mcp-server-win-cli#understanding-exit-codes'
      },
      [-1]: {
        meaning: 'Execution Failure',
        description: 'Command failed to run, timed out, or encountered a process error. The command passed validation but failed during execution.',
        user_action: 'Check the error message for details. Common fixes: verify command syntax, increase timeout, check working directory exists, ensure required files/permissions are available.',
        diagnostic_tools: ['read_command_history', 'check_security_config', 'read_current_directory', 'test_connection'],
        common_causes: [
          'Command timed out (exceeded commandTimeout seconds)',
          'Process spawn failed (shell not found or not accessible)',
          'Command syntax error in the shell',
          'Working directory does not exist',
          'Missing file or permission denied',
          'Network timeout for SSH commands'
        ],
        help_url: 'https://github.com/quanticsoul4772/mcp-server-win-cli#issue-command-times-out'
      },
      [-2]: {
        meaning: 'Validation Failure',
        description: 'Command was blocked by security rules before execution. The server prevented the command from running due to security policy violations.',
        user_action: 'The command violated security rules. Check what was blocked: command name, arguments, operators, path restrictions, or length limits. Use diagnostic tools to identify the specific issue.',
        diagnostic_tools: ['validate_command', 'check_security_config'],
        common_causes: [
          'Command is in blockedCommands list (e.g., rm, del, shutdown)',
          'Command uses blocked operators (&, |, ;, >, <)',
          'Command uses blocked arguments (e.g., --exec, -enc, /c)',
          'Working directory is outside allowedPaths',
          'Command exceeds maxCommandLength',
          'Shell operators detected (pipes, redirects, command chaining)'
        ],
        help_url: 'https://github.com/quanticsoul4772/mcp-server-win-cli#issue-command-is-blocked-or-command-contains-blocked-command'
      },
      1: {
        meaning: 'General Error',
        description: 'The command ran but returned a general error code. This is a standard exit code from the executed process.',
        user_action: 'Check the command output for specific error messages. The command syntax may be incorrect, or the command failed due to its own internal logic.',
        common_causes: [
          'Command syntax error',
          'File not found',
          'Invalid arguments',
          'Operation not permitted'
        ]
      },
      2: {
        meaning: 'Misuse of Shell Command',
        description: 'The shell could not execute the command due to incorrect usage.',
        user_action: 'Verify command syntax and arguments are correct for the shell being used (PowerShell/CMD/Git Bash).',
        common_causes: [
          'Invalid command syntax',
          'Missing required arguments',
          'Incorrect shell-specific syntax'
        ]
      },
      126: {
        meaning: 'Command Not Executable',
        description: 'The command was found but cannot be executed (permission denied or not executable).',
        user_action: 'Check file permissions or verify the command is executable.',
        common_causes: [
          'File lacks execute permissions',
          'File is not a valid executable',
          'Path points to directory instead of file'
        ]
      },
      127: {
        meaning: 'Command Not Found',
        description: 'The shell could not find the command.',
        user_action: 'Verify the command exists and is in the system PATH, or use the full path to the executable.',
        common_causes: [
          'Command not installed',
          'Command not in PATH',
          'Typo in command name',
          'Wrong shell selected (e.g., bash command in PowerShell)'
        ]
      },
      130: {
        meaning: 'Terminated by Ctrl+C',
        description: 'Process was terminated by SIGINT (Ctrl+C signal).',
        user_action: 'The process was interrupted. If this was unintentional, run the command again.',
        common_causes: [
          'User interrupted the process',
          'Timeout triggered termination'
        ]
      }
    };

    // Return specific explanation if available, otherwise generic
    if (explanations[exitCode]) {
      return explanations[exitCode];
    }

    // Generic explanation for unknown exit codes
    return {
      meaning: 'Process-Specific Exit Code',
      description: `This exit code (${exitCode}) is specific to the command that was executed. It is not a server-generated code.`,
      user_action: 'Check the command\'s documentation or output message to understand what this exit code means. Common exit codes: 0=success, 1=general error, 2=misuse.',
      diagnostic_tools: ['read_command_history'],
      common_causes: [
        'Command-specific error condition',
        'Application-defined exit code',
        'Refer to command documentation for details'
      ]
    };
  }
}
