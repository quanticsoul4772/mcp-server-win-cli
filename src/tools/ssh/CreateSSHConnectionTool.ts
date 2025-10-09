import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { SSHConnectionConfig } from '../../types/config.js';
import { createSSHConnection } from '../../utils/sshManager.js';

interface CreateSSHConnectionArgs {
  connectionId: string;
  connectionConfig: SSHConnectionConfig;
}

/**
 * CreateSSHConnectionTool
 *
 * Creates a new SSH connection in the configuration file.
 */
export class CreateSSHConnectionTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'create_ssh_connection',
      '[SSH Operations] Create a new SSH connection',
      'SSH Operations'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        connectionId: {
          type: 'string',
          description: 'ID of the SSH connection'
        },
        connectionConfig: {
          type: 'object',
          properties: {
            host: {
              type: 'string',
              description: 'Host of the SSH connection'
            },
            port: {
              type: 'number',
              description: 'Port of the SSH connection'
            },
            username: {
              type: 'string',
              description: 'Username for the SSH connection'
            },
            password: {
              type: 'string',
              description: 'Password for the SSH connection'
            },
            privateKeyPath: {
              type: 'string',
              description: 'Path to the private key for the SSH connection'
            }
          },
          required: ['host', 'port', 'username']
        }
      },
      required: ['connectionId', 'connectionConfig']
    };
  }

  async execute(args: CreateSSHConnectionArgs): Promise<ToolResult> {
    const { connectionId, connectionConfig } = args;

    try {
      await createSSHConnection(connectionId, connectionConfig);
      return this.success(`Successfully created SSH connection '${connectionId}'`);
    } catch (error) {
      return this.error(
        `Failed to create SSH connection: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
