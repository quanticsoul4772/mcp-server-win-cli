import type { ServiceContainer } from "../../server/ServiceContainer.js";
import type { ToolResult, ToolCategory } from "./types.js";

/**
 * Abstract base class for all MCP tools
 *
 * Provides common functionality:
 * - Service container access for dependency injection
 * - Standardized tool metadata (name, description, category)
 * - Abstract methods for schema and execution
 * - Helper methods for service retrieval
 *
 * @example
 * ```typescript
 * export class ExecuteCommandTool extends BaseTool {
 *   constructor(container: ServiceContainer) {
 *     super(
 *       container,
 *       'execute_command',
 *       '[Command Execution] Execute a command in specified shell',
 *       'Command Execution'
 *     );
 *   }
 *
 *   getInputSchema() {
 *     return {
 *       type: "object",
 *       properties: {
 *         shell: { type: "string", enum: ["powershell", "cmd", "gitbash"] },
 *         command: { type: "string" }
 *       },
 *       required: ["shell", "command"]
 *     };
 *   }
 *
 *   async execute(args: any): Promise<ToolResult> {
 *     const executor = this.getService<CommandExecutor>('commandExecutor');
 *     const result = await executor.execute(args);
 *     return this.success(result.output, { exitCode: result.exitCode });
 *   }
 * }
 * ```
 */
export abstract class BaseTool {
  /**
   * Create a new tool instance
   *
   * @param container - Service container for dependency injection
   * @param name - Unique tool identifier (e.g., 'execute_command')
   * @param description - Human-readable tool description
   * @param category - Tool category for organization (optional)
   */
  constructor(
    protected readonly container: ServiceContainer,
    public readonly name: string,
    public readonly description: string,
    public readonly category?: ToolCategory
  ) {}

  /**
   * Get the JSON schema for tool input validation
   * This defines what arguments the tool accepts
   *
   * @returns JSON schema object for tool arguments
   */
  abstract getInputSchema(): any;

  /**
   * Execute the tool with provided arguments
   *
   * @param args - Tool arguments (validated against input schema)
   * @returns Tool execution result
   */
  abstract execute(args: any): Promise<ToolResult>;

  /**
   * Get a service from the container with type safety
   *
   * @param name - Service identifier
   * @returns The requested service instance
   * @throws Error if service not found
   */
  protected getService<T>(name: string): T {
    return this.container.get<T>(name);
  }

  /**
   * Try to get an optional service
   *
   * @param name - Service identifier
   * @returns The service instance or undefined
   */
  protected tryGetService<T>(name: string): T | undefined {
    return this.container.tryGet<T>(name);
  }

  /**
   * Helper to create a successful tool result
   *
   * @param text - Result text to return
   * @param metadata - Optional metadata (exitCode, etc.)
   * @returns Formatted tool result
   */
  protected success(text: string, metadata?: { exitCode?: number; [key: string]: any }): ToolResult {
    return {
      content: [{
        type: 'text',
        text
      }],
      _meta: metadata ? { exitCode: metadata.exitCode, metadata } : undefined
    };
  }

  /**
   * Helper to create an error tool result
   *
   * @param message - Error message
   * @param exitCode - Exit code (default: -1)
   * @returns Formatted error result
   */
  protected error(message: string, exitCode: number = -1): ToolResult {
    return {
      content: [{
        type: 'text',
        text: message
      }],
      isError: true,
      _meta: { exitCode }
    };
  }

  /**
   * Helper to create a validation error result
   *
   * @param message - Validation error message
   * @returns Formatted validation error (exitCode: -2)
   */
  protected validationError(message: string): ToolResult {
    return this.error(message, -2);
  }
}
