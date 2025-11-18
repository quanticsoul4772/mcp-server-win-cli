/**
 * JSON-serializable primitive types
 */
export type JsonPrimitive = string | number | boolean | null | undefined;

/**
 * JSON-serializable value (recursive type)
 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/**
 * JSON-serializable object
 */
export type JsonObject = { [key: string]: JsonValue };

/**
 * Structured error information to help Claude diagnose and resolve issues
 */
export interface StructuredError {
  /** Error type identifier (e.g., 'command_blocked', 'path_not_allowed') */
  error: string;
  /** Error code for categorization (e.g., 'SEC001', 'VAL002') */
  code: string;
  /** Additional error details specific to the error type */
  details: JsonObject;
  /** Human-readable guidance for resolving the error */
  user_guidance: string;
  /** Suggested diagnostic tool to run for more information */
  diagnostic_tool?: string;
  /** Arguments to pass to the diagnostic tool */
  diagnostic_args?: JsonObject;
  /** URL to documentation for this error */
  help_url?: string;
}

/**
 * Result of a tool execution
 */
export interface ToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text: string;
  }>;
  isError?: boolean;
  _meta?: {
    exitCode?: number;
    metadata?: JsonObject;
    /** Structured error information for Claude to parse */
    structured?: StructuredError;
  };
}

/**
 * Property definition in a JSON Schema
 */
export interface SchemaProperty {
  type: string;
  description?: string;
  enum?: readonly string[];
  default?: JsonValue;
  minimum?: number;
  maximum?: number;
  items?: { type: string };
  properties?: Record<string, SchemaProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

/**
 * JSON Schema type for tool input validation
 */
export interface ToolInputSchema {
  type: string;
  properties: Record<string, SchemaProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
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
