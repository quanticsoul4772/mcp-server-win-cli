import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { EnvironmentManager } from '../../services/EnvironmentManager.js';

interface ListEnvironmentVariablesArgs {
  filter?: string;
  show_blocked_count?: boolean;
  category?: 'all' | 'system' | 'user';
}

/**
 * ListEnvironmentVariablesTool
 *
 * Lists all accessible environment variables with optional filtering.
 * Sensitive variables are automatically excluded for security.
 */
export class ListEnvironmentVariablesTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'list_environment_variables',
      `[Diagnostics] List all accessible environment variables with optional filtering

Example usage:
\`\`\`json
{
  "filter": "^PATH|^TEMP",
  "show_blocked_count": true,
  "category": "system"
}
\`\`\`

Security:
- Sensitive variables (API keys, passwords) automatically excluded
- Case-insensitive filtering
- Read-only access`,
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Regex pattern to filter variable names (e.g., "^PATH|^TEMP")'
        },
        show_blocked_count: {
          type: 'boolean',
          description: 'Show count of blocked variables (default: true)',
          default: true
        },
        category: {
          type: 'string',
          enum: ['all', 'system', 'user'],
          description: 'Filter by variable category (Windows-specific, default: all)',
          default: 'all'
        }
      }
    };
  }

  async execute(args: ListEnvironmentVariablesArgs): Promise<ToolResult> {
    const envManager = this.getService<EnvironmentManager>('EnvironmentManager');
    const { filter, show_blocked_count = true, category = 'all' } = args;

    try {
      // Validate regex if provided
      if (filter) {
        try {
          new RegExp(filter, 'i');
        } catch (e) {
          return this.validationError(`Invalid regex pattern: ${filter}`);
        }
      }

      const variables = envManager.listVariables(filter);
      const blockedVars = envManager.getBlockedVariables();

      // Category filtering (Windows-specific)
      const systemVars = new Set([
        'PATH', 'PATHEXT', 'TEMP', 'TMP', 'OS', 'PROCESSOR_ARCHITECTURE',
        'SYSTEMROOT', 'WINDIR', 'PROGRAMFILES', 'COMMONPROGRAMFILES',
        'COMSPEC', 'HOMEDRIVE', 'SYSTEMDRIVE', 'NUMBER_OF_PROCESSORS',
        'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION'
      ]);

      let filteredVars = variables;
      if (category === 'system') {
        filteredVars = Object.fromEntries(
          Object.entries(variables).filter(([k]) => systemVars.has(k.toUpperCase()))
        );
      } else if (category === 'user') {
        filteredVars = Object.fromEntries(
          Object.entries(variables).filter(([k]) => !systemVars.has(k.toUpperCase()))
        );
      }

      const result: any = {
        count: Object.keys(filteredVars).length,
        variables: filteredVars,
        filter_applied: filter || null,
        category
      };

      if (show_blocked_count) {
        result.security = {
          blocked_count: blockedVars.length,
          note: 'Sensitive variables (API keys, passwords, tokens) are blocked for security'
        };
      }

      return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to list environment variables: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
