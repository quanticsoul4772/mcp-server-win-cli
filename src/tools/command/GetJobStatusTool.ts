import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { JobManager } from '../../services/JobManager.js';

interface GetJobStatusArgs {
  jobId: string;
}

/**
 * GetJobStatusTool
 *
 * Get status and metadata for a background job.
 * Does not return full output (use get_job_output for that).
 */
export class GetJobStatusTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'get_job_status',
      `[Command Execution] Get status and metadata for a background job

Example usage:
\`\`\`json
{
  "jobId": "job_1"
}
\`\`\`

Returns job status, runtime, exit code, and output preview (first 500 chars).`,
      'Command Execution'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'Job ID to query'
        }
      },
      required: ['jobId']
    };
  }

  async execute(args: GetJobStatusArgs): Promise<ToolResult> {
    const { jobId } = args;

    try {
      const jobManager = this.getService<JobManager>('JobManager');
      const job = jobManager.getJob(jobId);

      if (!job) {
        return this.error(`Job not found: ${jobId}`, -2);
      }

      const runtime = job.endTime
        ? job.endTime - job.startTime
        : Date.now() - job.startTime;

      const result = {
        jobId: job.id,
        shell: job.shell,
        command: job.command,
        status: job.status,
        pid: job.pid,
        startTime: new Date(job.startTime).toISOString(),
        endTime: job.endTime ? new Date(job.endTime).toISOString() : null,
        runtimeMs: runtime,
        exitCode: job.exitCode ?? null,
        outputSize: job.output.length,
        outputPreview: job.output.substring(0, 500),
        timestamp: new Date().toISOString()
      };

      return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to get job status: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
