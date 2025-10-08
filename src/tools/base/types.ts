/**
 * Result of a tool execution
 */
export interface ToolResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
  _meta?: {
    exitCode?: number;
    metadata?: Record<string, any>;
  };
}

/**
 * Tool category for organization
 */
export type ToolCategory =
  | 'Command Execution'
  | 'SSH Operations'
  | 'Diagnostics'
  | 'System Info'
  | 'Configuration'
  | 'Uncategorized';
