import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { SSHConnectionPool } from '../../utils/ssh.js';
import type { ConfigManager } from '../../services/ConfigManager.js';
import { normalizeLocalPath, isWSLPath } from '../../utils/wslPaths.js';
import { validatePathAllowed } from '../../utils/pathSecurity.js';
import fs from 'fs/promises';
import path from 'path';

interface SFTPDownloadArgs {
  connectionId: string;
  remotePath: string;
  localPath: string;
}

/**
 * SFTPDownloadTool
 *
 * Download file from remote SSH host via SFTP.
 * Creates local directory if it doesn't exist.
 */
export class SFTPDownloadTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'sftp_download',
      `[SSH Operations] Download file from remote host via SFTP

Example usage:
\`\`\`json
{
  "connectionId": "raspberry-pi",
  "remotePath": "/home/pi/file.txt",
  "localPath": "C:\\\\downloads\\\\file.txt"
}
\`\`\`

Security: Local path must be absolute. Creates parent directories if needed.`,
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
          description: 'Absolute path to remote file to download'
        },
        localPath: {
          type: 'string',
          description: 'Absolute path where file will be saved locally'
        }
      },
      required: ['connectionId', 'remotePath', 'localPath']
    };
  }

  async execute(args: SFTPDownloadArgs): Promise<ToolResult> {
    const { connectionId, remotePath, localPath } = args;

    try {
      // Validate local path format
      const isWSL = isWSLPath(localPath);
      const isWindowsAbsolute = path.isAbsolute(localPath);

      if (!isWindowsAbsolute && !isWSL) {
        return this.validationError('Local path must be absolute (Windows, WSL network, or Unix format)');
      }

      // Validate remote path is absolute
      if (!remotePath.startsWith('/')) {
        return this.validationError('Remote path must be absolute (start with /)');
      }

      // Normalize WSL paths to Windows paths
      let normalizedLocalPath: string;
      try {
        normalizedLocalPath = await normalizeLocalPath(localPath);
      } catch (error) {
        return this.error(
          `Failed to normalize local path: ${error instanceof Error ? error.message : String(error)}`,
          -1
        );
      }

      // Security validation: Check normalized path against allowedPaths
      const configManager = this.getService<ConfigManager>('ConfigManager');
      const securityConfig = configManager.getSecurity();

      const parentDir = path.dirname(normalizedLocalPath);
      const validation = await validatePathAllowed(
        parentDir,
        securityConfig.allowedPaths,
        securityConfig.restrictWorkingDirectory
      );

      if (!validation.allowed) {
        return this.validationError(`${validation.error} Original path: ${localPath}`);
      }

      // Create parent directory
      try {
        await fs.mkdir(parentDir, { recursive: true });
      } catch (error) {
        return this.error(
          `Failed to create parent directory: ${error instanceof Error ? error.message : String(error)}`,
          -1
        );
      }
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

        // Download file using normalized path
        await sftp.get(remotePath, normalizedLocalPath, {});

        const duration = Date.now() - startTime;
        const fileStats = await fs.stat(normalizedLocalPath);

        const result = {
          connectionId,
          remotePath,
          localPath: localPath,
          normalizedPath: normalizedLocalPath,
          fileSize: fileStats.size,
          downloadDurationMs: duration,
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
        `SFTP download failed: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
