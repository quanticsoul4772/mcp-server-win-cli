import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { SSHConnectionPool } from '../../utils/ssh.js';
import fs from 'fs/promises';
import path from 'path';

interface SFTPUploadArgs {
  connectionId: string;
  localPath: string;
  remotePath: string;
}

/**
 * SFTPUploadTool
 *
 * Upload file to remote SSH host via SFTP.
 * Validates local file exists before upload.
 */
export class SFTPUploadTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'sftp_upload',
      `[SSH Operations] Upload file to remote host via SFTP

Example usage:
\`\`\`json
{
  "connectionId": "raspberry-pi",
  "localPath": "C:\\\\data\\\\file.txt",
  "remotePath": "/home/pi/file.txt"
}
\`\`\`

Security: Validates local file exists. Remote path must be absolute.`,
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
        localPath: {
          type: 'string',
          description: 'Absolute path to local file to upload'
        },
        remotePath: {
          type: 'string',
          description: 'Absolute path on remote host where file will be uploaded'
        }
      },
      required: ['connectionId', 'localPath', 'remotePath']
    };
  }

  async execute(args: SFTPUploadArgs): Promise<ToolResult> {
    const { connectionId, localPath, remotePath } = args;

    try {
      // Validate local path is absolute
      if (!path.isAbsolute(localPath)) {
        return this.validationError('Local path must be absolute');
      }

      // Validate remote path is absolute (Unix-style)
      if (!remotePath.startsWith('/')) {
        return this.validationError('Remote path must be absolute (start with /)');
      }

      // Check if local file exists
      try {
        const stats = await fs.stat(localPath);
        if (!stats.isFile()) {
          return this.validationError('Local path must be a file, not a directory');
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return this.validationError(`Local file not found: ${localPath}`);
        }
        throw error;
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
        const startTime = Date.now();

        // Upload file
        await sftp.put(localPath, remotePath, {});

        const duration = Date.now() - startTime;
        const fileStats = await fs.stat(localPath);

        const result = {
          connectionId,
          localPath,
          remotePath,
          fileSize: fileStats.size,
          uploadDurationMs: duration,
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
        `SFTP upload failed: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
