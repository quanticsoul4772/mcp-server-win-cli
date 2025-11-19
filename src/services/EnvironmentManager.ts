import type { ConfigManager } from './ConfigManager.js';

/**
 * Default blocked environment variables (sensitive data)
 */
const DEFAULT_BLOCKED_ENV_VARS = [
  // Authentication & API Keys
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'AZURE_CLIENT_SECRET',
  'GCP_SERVICE_ACCOUNT_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'NPM_TOKEN',

  // Database Credentials
  'DB_PASSWORD',
  'DATABASE_PASSWORD',
  'MYSQL_PASSWORD',
  'POSTGRES_PASSWORD',
  'MONGODB_PASSWORD',

  // Generic Secrets
  'SECRET',
  'PASSWORD',
  'TOKEN',
  'API_KEY',
  'PRIVATE_KEY',
  'CLIENT_SECRET',

  // System Security
  'SSH_PRIVATE_KEY',
  'GPG_PASSPHRASE',
  'ENCRYPTION_KEY',

  // System Path Variables (high-risk for privilege escalation)
  'PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH'
];

/**
 * Default maximum number of custom environment variables per command
 */
const DEFAULT_MAX_CUSTOM_ENV_VARS = 20;

/**
 * Default maximum length of environment variable values
 */
const DEFAULT_MAX_ENV_VAR_VALUE_LENGTH = 32768;

/**
 * EnvironmentManager Service
 *
 * Provides secure access to environment variables with:
 * - Blocklist/allowlist security controls
 * - Case-insensitive variable name matching
 * - Pattern-based filtering
 * - Read-only operations (no write access)
 *
 * @example
 * ```typescript
 * const envMgr = new EnvironmentManager(configManager);
 *
 * // Check if variable is accessible
 * if (envMgr.isVariableAccessible('PATH')) {
 *   const value = envMgr.getVariable('PATH');
 * }
 *
 * // List all accessible variables
 * const vars = envMgr.listVariables();
 * ```
 */
export class EnvironmentManager {
  private readonly blockedVariables: Set<string>;
  private readonly allowedVariables?: Set<string>;

  /**
   * Create an EnvironmentManager instance
   *
   * @param configManager - ConfigManager for read-only access (optional for validation/merge only)
   * @param blockedVariables - List of blocked variable patterns
   * @param allowedVariables - Optional allowlist (if set, only these are allowed)
   */
  constructor(
    private readonly configManager: ConfigManager | null,
    blockedVariables: string[] = DEFAULT_BLOCKED_ENV_VARS,
    allowedVariables?: string[]
  ) {
    this.blockedVariables = new Set(blockedVariables.map(v => v.toUpperCase()));
    this.allowedVariables = allowedVariables
      ? new Set(allowedVariables.map(v => v.toUpperCase()))
      : undefined;
  }

  /**
   * Get a single environment variable value
   *
   * @param name - Variable name (case-insensitive)
   * @returns Variable value or undefined if not set
   * @throws Error if variable is blocked or not allowed
   */
  public getVariable(name: string): string | undefined {
    if (!this.isVariableAccessible(name)) {
      throw new Error(`Environment variable "${name}" is blocked for security reasons`);
    }

    return process.env[name];
  }

  /**
   * Get multiple environment variables
   *
   * @param names - Array of variable names
   * @returns Record with accessible variables only (blocked ones omitted)
   */
  public getVariables(names: string[]): Record<string, string> {
    const result: Record<string, string> = {};

    for (const name of names) {
      if (this.isVariableAccessible(name)) {
        const value = process.env[name];
        if (value !== undefined) {
          result[name] = value;
        }
      }
    }

    return result;
  }

  /**
   * List all accessible environment variables
   *
   * @param filter - Optional regex pattern to filter variable names
   * @returns Record with accessible variables matching filter
   */
  public listVariables(filter?: string): Record<string, string> {
    const result: Record<string, string> = {};
    let filterRegex: RegExp | undefined;

    if (filter) {
      try {
        filterRegex = new RegExp(filter, 'i');
      } catch (e) {
        throw new Error(`Invalid regex pattern: ${filter}`);
      }
    }

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;

      // Apply filter if provided
      if (filterRegex && !filterRegex.test(key)) {
        continue;
      }

      // Check accessibility
      if (this.isVariableAccessible(key)) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Validate if a variable name is accessible
   *
   * @param name - Variable name to check
   * @returns True if accessible, false if blocked
   */
  public isVariableAccessible(name: string): boolean {
    const upperName = name.toUpperCase();

    // Allowlist mode: if allowlist exists, ONLY those variables are accessible
    if (this.allowedVariables) {
      return this.allowedVariables.has(upperName);
    }

    // Blocklist mode: check if variable is blocked
    // Check exact match
    if (this.blockedVariables.has(upperName)) {
      return false;
    }

    // Check if variable name contains blocked patterns
    for (const blocked of this.blockedVariables) {
      if (upperName.includes(blocked)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get blocked variable patterns for diagnostics
   *
   * @returns Array of blocked variable patterns
   */
  public getBlockedVariables(): string[] {
    return Array.from(this.blockedVariables);
  }

  /**
   * Get allowed variable names (if allowlist mode is enabled)
   *
   * @returns Array of allowed variable names or undefined if blocklist mode
   */
  public getAllowedVariables(): string[] | undefined {
    return this.allowedVariables ? Array.from(this.allowedVariables) : undefined;
  }

  /**
   * Check if running in allowlist mode
   *
   * @returns True if allowlist mode, false if blocklist mode
   */
  public isAllowlistMode(): boolean {
    return this.allowedVariables !== undefined;
  }

  // ============================================================================
  // Environment Variable Validation Methods (for command execution)
  // ============================================================================

  /**
   * Validate environment variable name for security
   *
   * @param name - Variable name to validate
   * @throws Error if variable is blocked or not allowed
   */
  public validateEnvVarName(name: string): void {
    const upperName = name.toUpperCase();

    // Allowlist mode: if allowlist exists, ONLY those variables can be set
    if (this.allowedVariables) {
      if (!this.allowedVariables.has(upperName)) {
        throw new Error(`Environment variable "${name}" is not in allowlist`);
      }
      return;
    }

    // Blocklist mode: check if variable is blocked
    if (this.blockedVariables.has(upperName)) {
      throw new Error(`Environment variable "${name}" is blocked for security`);
    }

    // Check if variable name contains blocked patterns
    for (const blocked of this.blockedVariables) {
      if (upperName.includes(blocked)) {
        throw new Error(
          `Environment variable "${name}" matches blocked pattern "${blocked}"`
        );
      }
    }
  }

  /**
   * Validate environment variable value for security and sanity
   *
   * @param name - Variable name (for error messages)
   * @param value - Variable value to validate
   * @param maxLength - Maximum allowed value length
   * @throws Error if value is invalid
   */
  public validateEnvVarValue(
    name: string,
    value: string,
    maxLength: number = DEFAULT_MAX_ENV_VAR_VALUE_LENGTH
  ): void {
    // Check for null bytes (can cause issues with C-based programs)
    if (value.includes('\0')) {
      throw new Error(
        `Environment variable "${name}" value contains null bytes which are not allowed`
      );
    }

    // Check length
    if (value.length > maxLength) {
      throw new Error(
        `Environment variable "${name}" value exceeds maximum length ` +
        `(${value.length} > ${maxLength})`
      );
    }

    // Check for dangerous control characters (except newline \n=0x0A and tab \t=0x09)
    const dangerousChars = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
    if (dangerousChars.test(value)) {
      throw new Error(
        `Environment variable "${name}" value contains dangerous control characters`
      );
    }
  }

  /**
   * Validate multiple environment variables (names and values)
   *
   * @param vars - Record of environment variables to validate
   * @param maxCount - Maximum number of variables allowed
   * @param maxValueLength - Maximum length of each value
   * @throws Error if any variable fails validation or count exceeds limit
   */
  public validateEnvVars(
    vars: Record<string, string>,
    maxCount: number = DEFAULT_MAX_CUSTOM_ENV_VARS,
    maxValueLength: number = DEFAULT_MAX_ENV_VAR_VALUE_LENGTH
  ): void {
    const keys = Object.keys(vars);

    if (keys.length > maxCount) {
      throw new Error(
        `Too many environment variables (${keys.length}). Maximum: ${maxCount}`
      );
    }

    for (const key of keys) {
      this.validateEnvVarName(key);
      this.validateEnvVarValue(key, vars[key], maxValueLength);
    }
  }

  /**
   * Merge environment variables with proper precedence
   *
   * Order of precedence (lowest to highest):
   * 1. System environment variables (process.env)
   * 2. Shell default environment variables
   * 3. User-provided environment variables
   *
   * @param shellDefaults - Default env vars from shell config
   * @param userOverrides - User-provided env vars
   * @returns Merged environment variables
   */
  public mergeEnvironmentVariables(
    shellDefaults?: Record<string, string>,
    userOverrides?: Record<string, string>
  ): Record<string, string> {
    return {
      ...process.env as Record<string, string>,
      ...(shellDefaults || {}),
      ...(userOverrides || {})
    };
  }

  /**
   * Get default blocked environment variables
   *
   * @returns Array of default blocked variable patterns
   */
  public static getDefaultBlockedEnvVars(): string[] {
    return [...DEFAULT_BLOCKED_ENV_VARS];
  }

  /**
   * Get default max custom env vars limit
   *
   * @returns Default max count
   */
  public static getDefaultMaxCustomEnvVars(): number {
    return DEFAULT_MAX_CUSTOM_ENV_VARS;
  }

  /**
   * Get default max env var value length
   *
   * @returns Default max length
   */
  public static getDefaultMaxEnvVarValueLength(): number {
    return DEFAULT_MAX_ENV_VAR_VALUE_LENGTH;
  }
}
