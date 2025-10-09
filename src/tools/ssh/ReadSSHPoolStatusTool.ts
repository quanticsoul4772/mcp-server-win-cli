import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import { SSHConnectionPool } from '../../utils/ssh.js';

/**
 * ReadSSHPoolStatusTool
 *
 * Returns the status and health of the SSH connection pool.
 */
export class ReadSSHPoolStatusTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'read_ssh_pool_status',
      '[SSH Operations] Get the status and health of the SSH connection pool',
      'SSH Operations'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {},
      required: []
    };
  }

  async execute(_args: Record<string, never>): Promise<ToolResult> {
    try {
      const sshPool = this.getService<SSHConnectionPool>('SSHConnectionPool');
      const status = sshPool.getPoolStats();

      return this.success(JSON.stringify(status, null, 2));
    } catch (error) {
      return this.error(
        `Failed to get SSH pool status: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
