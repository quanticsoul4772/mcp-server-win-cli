/**
 * Sanitizes error messages to prevent information disclosure
 * Removes internal paths, stack traces, and sensitive details
 */

import path from 'path';
import os from 'os';

/**
 * Sanitize a path to remove sensitive information (usernames, home directories)
 * while preserving useful context for the user
 * 
 * @param pathStr - The path to sanitize
 * @param userProvidedPath - Optional path that the user provided (safe to show)
 * @returns Sanitized path with sensitive info removed
 */
export function sanitizePathError(pathStr: string, userProvidedPath?: string): string {
  // If it's a user-provided path, we can show it
  if (userProvidedPath && pathStr.includes(userProvidedPath)) {
    return userProvidedPath;
  }

  const homeDir = os.homedir();
  const username = path.basename(homeDir);
  
  // Replace home directory with ~
  let sanitized = pathStr.replace(new RegExp(homeDir.replace(/\\/g, '\\\\'), 'gi'), '~');
  
  // Remove usernames from paths
  if (username) {
    sanitized = sanitized.replace(new RegExp(`\\b${username}\\b`, 'gi'), '[user]');
  }
  
  // Remove common sensitive path segments
  sanitized = sanitized
    .replace(/C:\\Users\\[^\\]+/gi, 'C:\\Users\\[user]')
    .replace(/\/home\/[^\/]+/gi, '/home/[user]')
    .replace(/\/Users\/[^\/]+/gi, '/Users/[user]')
    .replace(/\\AppData\\/gi, '\\[AppData]\\')
    .replace(/\/\.local\//gi, '/[.local]/');
  
  return sanitized;
}

/**
 * Sanitize config file paths to mask usernames while preserving useful info
 * 
 * @param configPath - The config file path to sanitize
 * @returns Sanitized config path
 */
export function sanitizeConfigPath(configPath: string): string {
  const homeDir = os.homedir();
  const username = path.basename(homeDir);
  
  // Replace home directory with ~
  let sanitized = configPath.replace(new RegExp(homeDir.replace(/\\/g, '\\\\'), 'gi'), '~');
  
  // Remove usernames from paths
  if (username) {
    sanitized = sanitized.replace(new RegExp(`\\b${username}\\b`, 'gi'), '[user]');
  }
  
  return sanitized;
}

/**
 * Sanitize an error message for client consumption
 */
export function sanitizeErrorMessage(error: Error | unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // First, sanitize any paths in the error message
  let sanitized = errorMessage;
  const homeDir = os.homedir();
  const username = path.basename(homeDir);
  
  // Replace home directory with ~
  sanitized = sanitized.replace(new RegExp(homeDir.replace(/\\/g, '\\\\'), 'gi'), '~');
  
  // Remove usernames
  if (username) {
    sanitized = sanitized.replace(new RegExp(`\\b${username}\\b`, 'gi'), '[user]');
  }
  
  // Remove absolute file paths (Windows and Unix) - more comprehensive
  sanitized = sanitized
    .replace(/[A-Z]:\\Users\\[^\\]+/gi, 'C:\\Users\\[user]')
    .replace(/[A-Z]:\\[\w\s\\\-_.()[\]{}]+/gi, '[PATH]')  // Windows paths
    .replace(/\/home\/[^\/]+/gi, '/home/[user]')
    .replace(/\/Users\/[^\/]+/gi, '/Users/[user]')
    .replace(/\/[\w\s/\-_.()[\]{}]+/g, '[PATH]')          // Unix paths
    .replace(/\\\\[\w\s\\\-_.()[\]{}]+/gi, '[UNC_PATH]'); // UNC paths

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
