import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { SSHConnectionPool } from '../../utils/ssh.js';

interface SFTPListDirectoryArgs {
  connectionId: string;
  remotePath: string;
  pattern?: string;
}

/**
 * SFTPListDirectoryTool
 *
 * List files and directories on remote SSH host via SFTP.
 * Supports optional glob pattern filtering.
 */
export class SFTPListDirectoryTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'sftp_list_directory',
      `[SSH Operations] List files and directories on remote host via SFTP

Example usage:
\`\`\`json
{
  "connectionId": "raspberry-pi",
  "remotePath": "/home/pi",
  "pattern": "*.txt"
}
\`\`\`

Security: Remote path must be absolute. Pattern supports glob wildcards.`,
      'SSH Operations'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        connectionId: {
          type: 'string',
          description: 'ID of the SSH connection to use'
        },
        remotePath: {
          type: 'string',
          description: 'Absolute path to remote directory'
        },
        pattern: {
          type: 'string',
          description: 'Optional glob pattern to filter files (e.g., "*.txt")'
        }
      },
      required: ['connectionId', 'remotePath']
    };
  }

  async execute(args: SFTPListDirectoryArgs): Promise<ToolResult> {
    const { connectionId, remotePath, pattern } = args;

    try {
      // Validate remote path is absolute (Unix-style)
      if (!remotePath.startsWith('/')) {
        return this.validationError('Remote path must be absolute (start with /)');
      }

      const configManager = this.getService<any>('ConfigManager');
      const sshConfig = configManager.getSSH();

      if (!sshConfig.connections[connectionId]) {
        return this.error(`SSH connection '${connectionId}' not found in configuration`, -2);
      }

      const sshPool = this.getService<SSHConnectionPool>('SSHConnectionPool');
      const connection = await sshPool.getConnection(connectionId, sshConfig.connections[connectionId]);

      // Get SFTP client
      const sftp = await connection.getSFTPClient();

      try {
        // List directory with optional pattern filtering
        const filterFn = pattern
          ? (item: any) => {
              const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
              return regex.test(item.name);
            }
          : undefined;

        const listResult = await sftp.list(remotePath, filterFn);

        // Format results
        const files = listResult.map((item: any) => ({
          name: item.name,
          type: item.type === 'd' ? 'directory' : item.type === 'l' ? 'symlink' : 'file',
          size: item.size,
          modifyTime: item.modifyTime,
          accessTime: item.accessTime,
          rights: {
            user: item.rights?.user || '',
            group: item.rights?.group || '',
            other: item.rights?.other || ''
          },
          owner: item.owner,
          group: item.group
        }));

        const result = {
          connectionId,
          remotePath,
          pattern: pattern || null,
          fileCount: files.length,
          files,
          timestamp: new Date().toISOString()
        };

        await sftp.end().catch(() => {}); // Ignore close errors

        return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
      } catch (error) {
        await sftp.end().catch(() => {}); // Ignore close errors
        throw error;
      }
    } catch (error) {
      return this.error(
        `SFTP list directory failed: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
