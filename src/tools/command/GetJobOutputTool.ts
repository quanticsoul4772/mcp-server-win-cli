import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { JobManager } from '../../services/JobManager.js';

interface GetJobOutputArgs {
  jobId: string;
  offset?: number;
}

/**
 * GetJobOutputTool
 *
 * Get output from a background job with streaming support.
 * Use offset parameter to get incremental output.
 */
export class GetJobOutputTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'get_job_output',
      `[Command Execution] Get output from a background job with streaming support

Example usage:
\`\`\`json
{
  "jobId": "job_1",
  "offset": 0
}
\`\`\`

Returns job output. Use offset to get only new output since last call (streaming).`,
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
        },
        offset: {
          type: 'number',
          description: 'Start position in output (default: 0, for streaming use last totalSize)',
          default: 0
        }
      },
      required: ['jobId']
    };
  }

  async execute(args: GetJobOutputArgs): Promise<ToolResult> {
    const { jobId, offset = 0 } = args;

    try {
      // Validate offset
      if (offset < 0) {
        return this.validationError('Offset must be >= 0');
      }

      const jobManager = this.getService<JobManager>('JobManager');
      const outputResult = jobManager.getJobOutput(jobId, offset);

      const result = {
        jobId,
        offset,
        output: outputResult.output,
        totalSize: outputResult.totalSize,
        complete: outputResult.complete,
        newDataSize: outputResult.output.length,
        nextOffset: outputResult.totalSize,
        timestamp: new Date().toISOString()
      };

      return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to get job output: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
