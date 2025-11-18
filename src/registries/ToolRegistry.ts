import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { BaseTool } from "../tools/base/BaseTool.js";
import type { ToolResult, ToolInputSchema } from "../tools/base/types.js";

/**
 * Tool Registry - Manages registration and execution of MCP tools
 *
 * Provides centralized tool management with:
 * - Dynamic tool registration
 * - Tool discovery and listing
 * - Schema retrieval for tool definitions
 * - Type-safe tool execution
 * - Category-based organization
 *
 * @example
 * ```typescript
 * const registry = new ToolRegistry();
 *
 * // Register a tool
 * registry.register(new ExecuteCommandTool(container));
 *
 * // List all tools
 * const tools = registry.listTools();
 *
 * // Execute a tool
 * const result = await registry.execute('execute_command', { shell: 'powershell', command: 'dir' });
 * ```
 */
export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();
  private categories: Map<string, Set<string>> = new Map();

  /**
   * Register a tool with the registry
   *
   * @param tool - Tool instance to register
   * @throws Error if tool with same name already registered
   */
  register(tool: BaseTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`);
    }

    this.tools.set(tool.name, tool);

    // Track by category
    const category = tool.category || 'Uncategorized';
    if (!this.categories.has(category)) {
      this.categories.set(category, new Set());
    }
    this.categories.get(category)!.add(tool.name);
  }

  /**
   * Register multiple tools at once
   *
   * @param tools - Array of tool instances
   */
  registerBatch(tools: BaseTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Check if a tool is registered
   *
   * @param name - Tool name to check
   * @returns True if tool exists, false otherwise
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get a tool by name
   *
   * @param name - Tool name
   * @returns The tool instance
   * @throws McpError if tool not found
   */
  get(name: string): BaseTool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${name}`
      );
    }
    return tool;
  }

  /**
   * List all registered tools
   *
   * @returns Array of all tool instances
   */
  listTools(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   *
   * @param category - Category name
   * @returns Array of tools in that category
   */
  getToolsByCategory(category: string): BaseTool[] {
    const toolNames = this.categories.get(category);
    if (!toolNames) {
      return [];
    }
    return Array.from(toolNames).map(name => this.tools.get(name)!);
  }

  /**
   * Get all categories
   *
   * @returns Array of category names
   */
  getCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * Execute a tool by name with provided arguments
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @returns Tool execution result
   * @throws McpError if tool not found or execution fails
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async execute(name: string, args: any): Promise<ToolResult> {
    const tool = this.get(name);

    try {
      return await tool.execute(args);
    } catch (error) {
      // If it's already an McpError, re-throw it
      if (error instanceof McpError) {
        throw error;
      }

      // Wrap other errors in McpError
      throw new McpError(
        ErrorCode.InternalError,
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get the input schema for a tool
   *
   * @param name - Tool name
   * @returns The tool's input schema
   * @throws McpError if tool not found
   */
  getSchema(name: string): ToolInputSchema {
    const tool = this.get(name);
    return tool.getInputSchema();
  }

  /**
   * Get all tools formatted for MCP ListTools response
   *
   * @returns Array of tool definitions with name, description, and input schema
   */
  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: ToolInputSchema }> {
    return this.listTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.getInputSchema()
    }));
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
    this.categories.clear();
  }

  /**
   * Get count of registered tools
   */
  count(): number {
    return this.tools.size;
  }
}
