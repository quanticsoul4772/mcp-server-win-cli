import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';

/**
 * ReadCurrentDirectoryTool
 *
 * Returns the server's current working directory.
 * Useful for understanding the execution context.
 */
export class ReadCurrentDirectoryTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'read_current_directory',
      '[System Info] Get the current working directory',
      'System Info'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {},
      required: []
    };
  }

  async execute(_args: Record<string, never>): Promise<ToolResult> {
    try {
      const cwd = process.cwd();
      return this.success(cwd);
    } catch (error) {
      return this.error(
        `Failed to get current directory: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
