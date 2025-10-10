import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { SSHConnectionPool } from '../../utils/ssh.js';

interface SFTPDeleteFileArgs {
  connectionId: string;
  remotePath: string;
  isDirectory?: boolean;
}

/**
 * SFTPDeleteFileTool
 *
 * Delete file or directory on remote SSH host via SFTP.
 * Requires explicit confirmation for directory deletion.
 */
export class SFTPDeleteFileTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'sftp_delete',
      `[SSH Operations] Delete file or directory on remote host via SFTP

Example usage:
\`\`\`json
{
  "connectionId": "raspberry-pi",
  "remotePath": "/home/pi/file.txt",
  "isDirectory": false
}
\`\`\`

SECURITY WARNING: Deletion is permanent and cannot be undone.
Remote path must be absolute. Set isDirectory=true to delete directories.`,
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
          description: 'Absolute path to remote file or directory to delete'
        },
        isDirectory: {
          type: 'boolean',
          description: 'Set to true to delete a directory (default: false)',
          default: false
        }
      },
      required: ['connectionId', 'remotePath']
    };
  }

  async execute(args: SFTPDeleteFileArgs): Promise<ToolResult> {
    const { connectionId, remotePath, isDirectory = false } = args;

    try {
      // Validate remote path is absolute (Unix-style)
      if (!remotePath.startsWith('/')) {
        return this.validationError('Remote path must be absolute (start with /)');
      }

      // Additional safety check: prevent deletion of root or home directories
      const dangerousPaths = ['/', '/home', '/root', '/etc', '/usr', '/var', '/bin', '/sbin'];
      if (dangerousPaths.includes(remotePath)) {
        return this.validationError('Cannot delete system directories');
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
        // Verify item exists before deletion
        let itemType: string;
        try {
          const stat = await sftp.stat(remotePath);
          itemType = (stat as any).isDirectory ? 'directory' : 'file';
        } catch (error: any) {
          if (error.code === 2) { // ENOENT
            await sftp.end().catch(() => {}); // Ignore close errors
            return this.error(`Remote path not found: ${remotePath}`, -2);
          }
          throw error;
        }

        // Validate type matches isDirectory parameter
        if (itemType === 'directory' && !isDirectory) {
          await sftp.end().catch(() => {}); // Ignore close errors
          return this.validationError(
            'Path is a directory. Set isDirectory=true to delete directories.'
          );
        }

        if (itemType === 'file' && isDirectory) {
          await sftp.end().catch(() => {}); // Ignore close errors
          return this.validationError(
            'Path is a file, not a directory. Set isDirectory=false.'
          );
        }

        // Perform deletion
        if (isDirectory) {
          await sftp.rmdir(remotePath, true); // true = recursive
        } else {
          await sftp.delete(remotePath);
        }

        const result = {
          connectionId,
          remotePath,
          itemType,
          deleted: true,
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
        `SFTP delete failed: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
