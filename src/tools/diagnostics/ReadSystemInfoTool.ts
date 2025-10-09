import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);

/**
 * Tool to read system information for diagnostics
 *
 * Helps Claude understand the user's environment:
 * - Operating system and Node.js version
 * - Available shells (PowerShell, CMD, Git Bash)
 * - Current working directory
 * - Server version and uptime
 * - Environment details
 */
export class ReadSystemInfoTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'read_system_info',
      '[Diagnostics] Get system information for troubleshooting',
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {}
    };
  }

  async execute(): Promise<ToolResult> {
    let packageJson: any;
    try {
      packageJson = require('../../../package.json');
    } catch {
      packageJson = { version: 'unknown' };
    }

    const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const gitBashExists = fs.existsSync(gitBashPath);

    // Check for PowerShell
    let hasPowershell = false;
    try {
      const { execSync } = await import('child_process');
      execSync('powershell.exe -Command "exit 0"', { timeout: 2000 });
      hasPowershell = true;
    } catch {
      hasPowershell = false;
    }

    // Check for CMD (should always be available on Windows)
    let hasCmd = false;
    try {
      const { execSync } = await import('child_process');
      execSync('cmd.exe /c "exit 0"', { timeout: 2000 });
      hasCmd = true;
    } catch {
      hasCmd = false;
    }

    const systemInfo = {
      server: {
        name: 'mcp-server-win-cli',
        version: packageJson.version,
        uptime_seconds: Math.floor(process.uptime()),
        uptime_formatted: this.formatUptime(process.uptime())
      },
      system: {
        platform: process.platform,
        os_type: os.type(),
        os_release: os.release(),
        arch: process.arch,
        hostname: os.hostname()
      },
      node: {
        version: process.version,
        v8_version: process.versions.v8
      },
      paths: {
        current_working_directory: process.cwd(),
        user_home: os.homedir(),
        temp_dir: os.tmpdir()
      },
      shells: {
        powershell: {
          available: hasPowershell,
          default_path: 'powershell.exe'
        },
        cmd: {
          available: hasCmd,
          default_path: 'cmd.exe'
        },
        git_bash: {
          available: gitBashExists,
          default_path: gitBashPath,
          note: gitBashExists ? 'Found' : 'Not found - install Git for Windows to use Git Bash'
        }
      },
      environment: {
        user: process.env.USERNAME || process.env.USER || 'unknown',
        user_profile: process.env.USERPROFILE,
        path_separator: process.platform === 'win32' ? ';' : ':',
        has_admin_rights: this.hasAdminRights()
      },
      memory: {
        total_mb: Math.round(os.totalmem() / 1024 / 1024),
        free_mb: Math.round(os.freemem() / 1024 / 1024),
        used_mb: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
        usage_percent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
      },
      cpu: {
        cores: os.cpus().length,
        model: os.cpus()[0]?.model || 'unknown'
      }
    };

    return this.success(JSON.stringify(systemInfo, null, 2), { exitCode: 0 });
  }

  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  private hasAdminRights(): string {
    // On Windows, check if running as admin
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        execSync('net session', { stdio: 'ignore', timeout: 1000 });
        return 'yes (running as administrator)';
      } catch {
        return 'no (running as regular user)';
      }
    }
    return 'unknown (not Windows)';
  }
}
