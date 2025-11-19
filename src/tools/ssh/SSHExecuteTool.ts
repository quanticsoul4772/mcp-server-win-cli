import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { ConfigManager } from '../../services/ConfigManager.js';
import type { SecurityManager } from '../../services/SecurityManager.js';
import { SSHConnectionPool } from '../../utils/ssh.js';

interface SSHExecuteArgs {
  connectionId: string;
  command: string;
  env?: Record<string, string>;
}

/**
 * SSHExecuteTool
 *
 * Executes commands on remote SSH hosts.
 */
export class SSHExecuteTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'ssh_execute',
      `[SSH Operations] Execute a command on a remote host via SSH

Example usage:
\`\`\`json
{
  "connectionId": "raspberry-pi",
  "command": "uname -a"
}
\`\`\`

Configuration required in config.json:
\`\`\`json
{
  "ssh": {
    "enabled": true,
    "connections": {
      "raspberry-pi": {
        "host": "raspberrypi.local",
        "port": 22,
        "username": "pi",
        "password": "raspberry"
      }
    }
  }
}
\`\`\``,
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
          description: 'ID of the SSH connection to use',
          enum: connectionIds
        },
        command: {
          type: 'string',
          description: 'Command to execute'
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Custom environment variables for remote command execution (optional). Note: SSH server must allow AcceptEnv for these variables.'
        }
      },
      required: ['connectionId', 'command']
    };
  }

  async execute(args: SSHExecuteArgs): Promise<ToolResult> {
    const { connectionId, command, env } = args;

    try {
      const configManager = this.getService<ConfigManager>('ConfigManager');
      const sshConfig = configManager.getSSH();

      if (!sshConfig.connections[connectionId]) {
        return this.error(`SSH connection '${connectionId}' not found in configuration`, -1);
      }

      // Validate environment variables if provided
      if (env && Object.keys(env).length > 0) {
        const securityManager = this.getService<SecurityManager>('SecurityManager');
        securityManager.validateEnvironmentVariables(env);
      }

      const sshPool = this.getService<SSHConnectionPool>('SSHConnectionPool');
      const connection = await sshPool.getConnection(connectionId, sshConfig.connections[connectionId]);
      const result = await connection.executeCommand(command, env);

      return this.success(result.output, { exitCode: result.exitCode });
    } catch (error) {
      return this.error(
        `SSH execution failed: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
