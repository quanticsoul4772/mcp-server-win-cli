import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { SSHConnectionConfig } from '../../types/config.js';
import { SSHConnection } from '../../utils/ssh.js';

interface ValidateSSHConnectionArgs {
  connectionConfig: SSHConnectionConfig;
}

/**
 * ValidateSSHConnectionTool
 *
 * Validates SSH connection configuration and tests connectivity.
 */
export class ValidateSSHConnectionTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'validate_ssh_connection',
      '[SSH Operations] Validate SSH connection configuration and test connectivity',
      'SSH Operations'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
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
      required: ['connectionConfig']
    };
  }

  async execute(args: ValidateSSHConnectionArgs): Promise<ToolResult> {
    const { connectionConfig } = args;

    try {
      // Create temporary connection to test
      const testConnection = new SSHConnection(connectionConfig, true);

      // Try to connect
      await testConnection.connect();

      // Detect shell type (this is called internally on first command)
      // We'll just execute a simple command to trigger detection
      const result = await testConnection.executeCommand('echo test');

      // Disconnect
      testConnection.disconnect();

      return this.success(
        `SSH connection validated successfully. Connection test output: ${result.output.trim()}`
      );
    } catch (error) {
      return this.error(
        `SSH connection validation failed: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
