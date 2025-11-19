import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { CommandExecutor } from '../../services/CommandExecutor.js';

interface ListProcessesArgs {
  filter?: string;
  limit?: number;
  sort_by?: 'cpu' | 'memory' | 'name';
}

/**
 * ListProcessesTool
 *
 * Lists running processes using PowerShell Get-Process.
 *
 * SECURITY WARNING: Process enumeration is MITRE ATT&CK T1057.
 * This tool is disabled by default and requires explicit configuration.
 */
export class ListProcessesTool extends BaseTool {
  private readonly BLOCKED_PROCESSES = [
    'lsass',      // Local Security Authority Subsystem Service
    'csrss',      // Client/Server Runtime Subsystem
    'smss',       // Session Manager Subsystem
    'wininit',    // Windows Start-Up Application
    'services',   // Services and Controller app
    'winlogon'    // Windows Logon Application
  ];

  private readonly MAX_RESULTS = 50;

  constructor(container: ServiceContainer) {
    super(
      container,
      'list_processes',
      `[System Info] List running processes (requires opt-in configuration)

Example usage:
\`\`\`json
{
  "filter": "chrome",
  "limit": 10,
  "sort_by": "cpu"
}
\`\`\`

SECURITY: This tool is disabled by default. Process enumeration can be used for reconnaissance.
To enable, add to config.json:
{
  "security": {
    "allowProcessListing": true
  }
}`,
      'System Info'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Filter processes by name (partial match)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10, max: 50)',
          default: 10
        },
        sort_by: {
          type: 'string',
          enum: ['cpu', 'memory', 'name'],
          description: 'Sort results by (default: cpu)',
          default: 'cpu'
        }
      }
    };
  }

  async execute(args: ListProcessesArgs): Promise<ToolResult> {
    const { filter, limit = 10, sort_by = 'cpu' } = args;

    try {
      // Check if process listing is enabled (opt-in security control)
      // Process listing is disabled by default due to security concerns (MITRE ATT&CK T1057)
      // Future: Add allowProcessListing to SecurityConfig schema to enable runtime configuration
      return this.error(
        'Process listing is disabled for security. This feature enables process reconnaissance (MITRE ATT&CK T1057). ' +
        'To enable, add "allowProcessListing": true to security config.',
        -2
      );

      // Validate limit
      if (limit < 1 || limit > this.MAX_RESULTS) {
        return this.validationError(`Limit must be between 1 and ${this.MAX_RESULTS}`);
      }

      const commandExecutor = this.getService<CommandExecutor>('CommandExecutor');

      // Build PowerShell command
      let sortProperty = sort_by === 'cpu' ? 'CPU' : sort_by === 'memory' ? 'WorkingSet' : 'ProcessName';
      let psCommand = 'Get-Process';

      if (filter) {
        psCommand += ` | Where-Object { $_.ProcessName -like '*${filter}*' }`;
      }

      psCommand += ` | Sort-Object ${sortProperty} -Descending | Select-Object -First ${limit} Id, ProcessName, CPU, @{Name="MemoryMB";Expression={[math]::Round($_.WorkingSet / 1MB, 2)}} | ConvertTo-Json`;

      const result = await commandExecutor.execute({
        shell: 'powershell',
        command: psCommand,
        timeout: 10
      });

      if (result.exitCode !== 0) {
        return this.error('Failed to list processes', result.exitCode);
      }

      // Parse JSON output
      let processes = JSON.parse(result.output);
      if (!Array.isArray(processes)) {
        processes = [processes];
      }

      // Filter out blocked processes
      processes = processes.filter((p: any) => {
        const name = p.ProcessName.toLowerCase();
        return !this.BLOCKED_PROCESSES.some(blocked => name.includes(blocked));
      });

      const response = {
        processes: processes.map((p: any) => ({
          id: p.Id,
          name: p.ProcessName,
          cpu_seconds: p.CPU ? parseFloat(p.CPU.toFixed(2)) : 0,
          memory_mb: p.MemoryMB
        })),
        count: processes.length,
        filter_applied: filter || null,
        sort_by,
        timestamp: new Date().toISOString(),
        note: 'System-critical processes are filtered for security'
      };

      return this.success(JSON.stringify(response, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to list processes: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
