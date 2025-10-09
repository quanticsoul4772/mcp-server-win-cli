import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { HistoryManager } from '../../services/HistoryManager.js';
import type { ConfigManager } from '../../services/ConfigManager.js';

interface ReadCommandHistoryArgs {
  limit?: number;
}

/**
 * ReadCommandHistoryTool
 *
 * Returns recent command execution history with outputs and exit codes.
 * Useful for reviewing what commands have been executed and their results.
 */
export class ReadCommandHistoryTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'read_command_history',
      `[Command Execution] Get the history of executed commands

Example usage:
\`\`\`json
{
  "limit": 5
}
\`\`\`

Example response:
\`\`\`json
[
  {
    "command": "Get-Process",
    "output": "...",
    "timestamp": "2024-03-20T10:30:00Z",
    "exitCode": 0
  }
]
\`\`\``,
      'Command Execution'
    );
  }

  getInputSchema() {
    const configManager = this.getService<ConfigManager>('ConfigManager');
    const maxHistorySize = configManager.getMaxHistorySize();

    return {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: `Maximum number of history entries to return (default: 10, max: ${maxHistorySize})`
        }
      },
      required: []
    };
  }

  async execute(args: ReadCommandHistoryArgs): Promise<ToolResult> {
    const historyManager = this.getService<HistoryManager>('HistoryManager');
    const configManager = this.getService<ConfigManager>('ConfigManager');

    const maxHistorySize = configManager.getMaxHistorySize();
    const limit = Math.min(args.limit || 10, maxHistorySize);

    try {
      const history = historyManager.getRecent(limit);
      return this.success(JSON.stringify(history, null, 2));
    } catch (error) {
      return this.error(
        `Failed to read command history: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
