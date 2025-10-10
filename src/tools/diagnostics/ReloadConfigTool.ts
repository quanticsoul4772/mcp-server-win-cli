import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { ConfigManager } from '../../services/ConfigManager.js';
import fs from 'fs';

interface ReloadConfigArgs {
  validate_before?: boolean;
}

/**
 * ReloadConfigTool
 *
 * Validates configuration file and previews reload.
 * Note: Full reload requires server restart (runtime reload not supported).
 */
export class ReloadConfigTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'reload_config',
      `[Diagnostics] Validate configuration file and preview reload (server restart required)

Example usage:
\`\`\`json
{
  "validate_before": true
}
\`\`\`

Note: This tool validates the config file. To apply changes, restart the MCP server.`,
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        validate_before: {
          type: 'boolean',
          description: 'Validate config file before reloading (default: true)',
          default: true
        }
      }
    };
  }

  async execute(args: ReloadConfigArgs): Promise<ToolResult> {
    const configManager = this.getService<ConfigManager>('ConfigManager');
    const { validate_before = true } = args;

    try {
      const configPath = configManager.getConfigPath();

      if (!configPath) {
        return this.error(
          'Cannot reload: No configuration file in use (server started with defaults). ' +
            'To use a config file, restart with --config flag.',
          -1
        );
      }

      // Check if file exists
      if (!fs.existsSync(configPath)) {
        return this.error(`Configuration file not found: ${configPath}`, -1);
      }

      // Read file content
      const fileContent = fs.readFileSync(configPath, 'utf8');
      let newConfig: any;

      // Parse JSON
      try {
        newConfig = JSON.parse(fileContent);
      } catch (e) {
        return this.error(
          `Configuration file has invalid JSON syntax: ${e instanceof Error ? e.message : String(e)}`,
          -2
        );
      }

      // Validate if requested
      if (validate_before) {
        const { ServerConfigSchema } = await import('../../types/schemas.js');
        try {
          ServerConfigSchema.parse(newConfig);
        } catch (e: any) {
          const errorMessage = e.errors
            ? e.errors.map((err: any) => `${err.path.join('.')}: ${err.message}`).join('; ')
            : e.message;
          return this.error(`Configuration validation failed: ${errorMessage}`, -2);
        }
      }

      const result = {
        status: 'validated',
        config_path: configPath,
        message: 'Configuration file is valid. Server restart required to apply changes.',
        note: 'Runtime config reload is not currently supported. Restart the MCP server to apply changes.',
        preview: {
          security_settings: newConfig.security ? 'present' : 'missing',
          shell_settings: newConfig.shells ? 'present' : 'missing',
          ssh_settings: newConfig.ssh ? 'present' : 'missing'
        },
        restart_command: 'Restart the MCP server process with the same --config flag'
      };

      return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to reload config: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
