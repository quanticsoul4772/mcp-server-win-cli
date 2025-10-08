/**
 * Sanitizes error messages to prevent information disclosure
 * Removes internal paths, stack traces, and sensitive details
 */

/**
 * Sanitize an error message for client consumption
 */
export function sanitizeErrorMessage(error: Error | unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Remove absolute file paths (Windows and Unix)
  let sanitized = errorMessage
    .replace(/[A-Z]:\\[\w\s\\\-_.]+/gi, '[PATH]')  // Windows paths
    .replace(/\/[\w\s/\-_.]+/g, '[PATH]')          // Unix paths
    .replace(/\\\\[\w\s\\\-_.]+/gi, '[UNC_PATH]'); // UNC paths

  // Remove stack trace lines
  sanitized = sanitized
    .split('\n')
    .filter(line => !line.trim().startsWith('at '))
    .join('\n');

  // Remove common internal error patterns
  sanitized = sanitized
    .replace(/Error: ENOENT:.*/, 'File or directory not found')
    .replace(/Error: EACCES:.*/, 'Permission denied')
    .replace(/Error: EPERM:.*/, 'Operation not permitted')
    .replace(/Error: EEXIST:.*/, 'File already exists')
    .replace(/ETIMEDOUT.*/, 'Operation timed out')
    .replace(/ECONNREFUSED.*/, 'Connection refused')
    .replace(/ECONNRESET.*/, 'Connection reset');

  // Remove Node.js module names and line numbers
  sanitized = sanitized
    .replace(/\(.*?:\d+:\d+\)/g, '')
    .replace(/node_modules.*?[\\/]/g, '');

  // Trim excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // Ensure the message is not empty
  if (!sanitized || sanitized.length === 0) {
    return 'An error occurred while processing your request';
  }

  return sanitized;
}

/**
 * Sanitize a full error object including stack
 */
export function sanitizeError(error: Error | unknown): { message: string; code?: string } {
  const message = sanitizeErrorMessage(error);

  // Preserve error codes if they exist and are safe
  const code = error instanceof Error && 'code' in error
    ? String((error as any).code)
    : undefined;

  // Allowlist of safe error codes
  const safeErrorCodes = [
    'ENOENT', 'EACCES', 'EPERM', 'EEXIST',
    'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET',
    'INVALID_REQUEST', 'METHOD_NOT_FOUND'
  ];

  return {
    message,
    code: code && safeErrorCodes.includes(code) ? code : undefined
  };
}

/**
 * Create a user-friendly error message from internal errors
 */
export function createUserFriendlyError(error: Error | unknown): string {
  const errorStr = error instanceof Error ? error.message : String(error);

  // Map common technical errors to user-friendly messages
  if (errorStr.includes('ENOENT') || errorStr.includes('not found')) {
    return 'The requested file or directory could not be found';
  }

  if (errorStr.includes('EACCES') || errorStr.includes('permission')) {
    return 'Access denied. Please check permissions';
  }

  if (errorStr.includes('ETIMEDOUT') || errorStr.includes('timeout')) {
    return 'The operation timed out. Please try again';
  }

  if (errorStr.includes('ECONNREFUSED') || errorStr.includes('connection')) {
    return 'Could not establish connection. Please verify the server is running';
  }

  if (errorStr.includes('spawn') || errorStr.includes('shell')) {
    return 'Failed to execute command. Please check the configuration';
  }

  // For unknown errors, return a generic message
  return sanitizeErrorMessage(error);
}
