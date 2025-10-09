import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { ConfigManager } from '../../services/ConfigManager.js';
import { SSHConnectionPool } from '../../utils/ssh.js';

interface SSHDisconnectArgs {
  connectionId: string;
}

/**
 * SSHDisconnectTool
 *
 * Disconnects from an SSH server and removes it from the connection pool.
 */
export class SSHDisconnectTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'ssh_disconnect',
      `[SSH Operations] Disconnect from an SSH server

Example usage:
\`\`\`json
{
  "connectionId": "raspberry-pi"
}
\`\`\`

Use this to cleanly close SSH connections when they're no longer needed.`,
      'SSH Operations'
    );
  }

  getInputSchema() {
    const configManager = this.getService<ConfigManager>('ConfigManager');
    const sshConfig = configManager.getSSH();
    const connectionIds = Object.keys(sshConfig.connections);

    return {
      type: 'object',
      properties: {
        connectionId: {
          type: 'string',
          description: 'ID of the SSH connection to disconnect',
          enum: connectionIds
        }
      },
      required: ['connectionId']
    };
  }

  async execute(args: SSHDisconnectArgs): Promise<ToolResult> {
    const { connectionId } = args;

    try {
      const sshPool = this.getService<SSHConnectionPool>('SSHConnectionPool');
      await sshPool.closeConnection(connectionId);

      return this.success(`Successfully disconnected from '${connectionId}'`);
    } catch (error) {
      return this.error(
        `Failed to disconnect: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
