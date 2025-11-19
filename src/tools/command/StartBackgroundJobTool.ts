import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { JobManager } from '../../services/JobManager.js';
import type { SecurityManager } from '../../services/SecurityManager.js';

interface StartBackgroundJobArgs {
  shell: 'powershell' | 'cmd' | 'gitbash';
  command: string;
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * StartBackgroundJobTool
 *
 * Start a command as a background job.
 * Returns immediately with job ID for status tracking.
 */
export class StartBackgroundJobTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'start_background_job',
      `[Command Execution] Start a command as a background job

Example usage:
\`\`\`json
{
  "shell": "powershell",
  "command": "Start-Sleep -Seconds 30; Write-Output 'Done'",
  "timeout": 60
}
\`\`\`

Returns job ID immediately. Use get_job_status to monitor progress.`,
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
        command: {
          type: 'string',
          description: 'Command to execute'
        },
        timeout: {
          type: 'number',
          description: 'Job timeout in seconds (default: 300, max: 3600)',
          default: 300
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Custom environment variables for command execution (optional)'
        }
      },
      required: ['shell', 'command']
    };
  }

  async execute(args: StartBackgroundJobArgs): Promise<ToolResult> {
    const { shell, command, timeout = 300, env } = args;

    try {
      // Validate timeout
      if (timeout < 1 || timeout > 3600) {
        return this.validationError('Timeout must be between 1 and 3600 seconds');
      }

      // Validate environment variables if provided
      if (env && Object.keys(env).length > 0) {
        const securityManager = this.getService<SecurityManager>('SecurityManager');
        securityManager.validateEnvironmentVariables(env);
      }

      const jobManager = this.getService<JobManager>('JobManager');
      const jobId = jobManager.startJob(shell, command, timeout, env);

      const result = {
        jobId,
        shell,
        command,
        timeout,
        startTime: new Date().toISOString(),
        message: 'Job started successfully. Use get_job_status to monitor progress.'
      };

      return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to start background job: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
