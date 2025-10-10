import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { EnvironmentManager } from '../../services/EnvironmentManager.js';

interface ReadEnvironmentVariableArgs {
  name: string;
  show_blocked_reason?: boolean;
}

/**
 * ReadEnvironmentVariableTool
 *
 * Reads a single environment variable with security filtering.
 * Sensitive variables (API keys, passwords, tokens) are blocked by default.
 */
export class ReadEnvironmentVariableTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'read_environment_variable',
      `[Diagnostics] Read a single environment variable with security filtering

Example usage:
\`\`\`json
{
  "name": "PATH",
  "show_blocked_reason": true
}
\`\`\`

Security:
- Sensitive variables (API_KEY, PASSWORD, TOKEN, SECRET) are blocked
- Case-insensitive variable name matching
- Read-only access (no write operations)`,
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the environment variable to read (case-insensitive)'
        },
        show_blocked_reason: {
          type: 'boolean',
          description: 'Show reason if variable is blocked (default: true)',
          default: true
        }
      },
      required: ['name']
    };
  }

  async execute(args: ReadEnvironmentVariableArgs): Promise<ToolResult> {
    const envManager = this.getService<EnvironmentManager>('EnvironmentManager');
    const { name, show_blocked_reason = true } = args;

    try {
      // Validate variable name format
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return this.validationError(
          `Invalid variable name format: "${name}". Must start with letter or underscore, contain only alphanumeric and underscore.`
        );
      }

      // Check if accessible
      if (!envManager.isVariableAccessible(name)) {
        const message = show_blocked_reason
          ? `Environment variable "${name}" is blocked for security reasons. It may contain sensitive data like API keys, passwords, or tokens.`
          : `Environment variable "${name}" is not accessible.`;

        return this.error(message, -2);
      }

      const value = envManager.getVariable(name);

      const result = {
        name,
        value: value ?? '(not set)',
        exists: value !== undefined,
        accessible: true
      };

      return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to read environment variable: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
