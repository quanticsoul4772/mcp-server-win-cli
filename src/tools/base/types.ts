/**
 * Structured error information to help Claude diagnose and resolve issues
 */
export interface StructuredError {
  /** Error type identifier (e.g., 'command_blocked', 'path_not_allowed') */
  error: string;
  /** Error code for categorization (e.g., 'SEC001', 'VAL002') */
  code: string;
  /** Additional error details specific to the error type */
  details: Record<string, any>;
  /** Human-readable guidance for resolving the error */
  user_guidance: string;
  /** Suggested diagnostic tool to run for more information */
  diagnostic_tool?: string;
  /** Arguments to pass to the diagnostic tool */
  diagnostic_args?: Record<string, any>;
  /** URL to documentation for this error */
  help_url?: string;
}

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
    /** Structured error information for Claude to parse */
    structured?: StructuredError;
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
