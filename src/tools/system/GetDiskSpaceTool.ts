import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { CommandExecutor } from '../../services/CommandExecutor.js';

interface GetDiskSpaceArgs {
  drive?: string;
  unit?: 'bytes' | 'MB' | 'GB';
}

/**
 * GetDiskSpaceTool
 *
 * Gets disk space information using PowerShell Get-PSDrive.
 * Returns total, used, and free space for drives.
 */
export class GetDiskSpaceTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'get_disk_space',
      `[System Info] Get disk space information for all drives or specific drive

Example usage:
\`\`\`json
{
  "drive": "C",
  "unit": "GB"
}
\`\`\`

Returns disk space info (total, used, free) in specified units.`,
      'System Info'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        drive: {
          type: 'string',
          description: 'Specific drive letter (e.g., "C", "D"). Omit for all drives.'
        },
        unit: {
          type: 'string',
          enum: ['bytes', 'MB', 'GB'],
          description: 'Unit for disk space values (default: GB)',
          default: 'GB'
        }
      }
    };
  }

  async execute(args: GetDiskSpaceArgs): Promise<ToolResult> {
    const { drive, unit = 'GB' } = args;

    try {
      const commandExecutor = this.getService<CommandExecutor>('CommandExecutor');

      // Build PowerShell command
      let psCommand = 'Get-PSDrive -PSProvider FileSystem';
      if (drive) {
        psCommand += ` | Where-Object { $_.Name -eq '${drive.toUpperCase()}' }`;
      }
      psCommand += ' | Select-Object Name, @{Name="Used";Expression={$_.Used}}, @{Name="Free";Expression={$_.Free}}, @{Name="Total";Expression={$_.Used + $_.Free}} | ConvertTo-Json';

      const result = await commandExecutor.execute({
        shell: 'powershell',
        command: psCommand,
        timeout: 10
      });

      if (result.exitCode !== 0) {
        return this.error('Failed to get disk space information', result.exitCode);
      }

      // Parse JSON output
      let drives = JSON.parse(result.output);
      if (!Array.isArray(drives)) {
        drives = [drives];
      }

      // Convert units
      const divisor = unit === 'bytes' ? 1 : unit === 'MB' ? 1024 * 1024 : 1024 * 1024 * 1024;
      const unitLabel = unit === 'bytes' ? 'bytes' : unit;

      const formattedDrives = drives.map((d: any) => {
        const used = d.Used || 0;
        const free = d.Free || 0;
        const total = d.Total || (used + free);
        const usagePercent = total > 0 ? ((used / total) * 100).toFixed(2) : '0.00';

        return {
          drive: d.Name + ':',
          total: parseFloat((total / divisor).toFixed(2)),
          used: parseFloat((used / divisor).toFixed(2)),
          free: parseFloat((free / divisor).toFixed(2)),
          usage_percent: parseFloat(usagePercent),
          unit: unitLabel
        };
      });

      const responseData = {
        drives: formattedDrives,
        unit: unitLabel,
        timestamp: new Date().toISOString()
      };

      return this.success(JSON.stringify(responseData, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to get disk space: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
