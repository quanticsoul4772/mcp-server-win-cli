import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import { readSSHConnections } from '../../utils/sshManager.js';

/**
 * ReadSSHConnectionsTool
 *
 * Returns all configured SSH connections (passwords masked).
 */
export class ReadSSHConnectionsTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'read_ssh_connections',
      '[SSH Operations] Read all SSH connections',
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
      const connections = await readSSHConnections();

      // Mask passwords for security
      const maskedConnections = Object.entries(connections).reduce((acc, [id, config]) => {
        acc[id] = {
          ...config,
          password: config.password ? '***MASKED***' : undefined
        };
        return acc;
      }, {} as Record<string, any>);

      return this.success(JSON.stringify(maskedConnections, null, 2));
    } catch (error) {
      return this.error(
        `Failed to read SSH connections: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
