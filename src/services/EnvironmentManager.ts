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
  'ENCRYPTION_KEY'
];

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

  constructor(
    private readonly configManager: ConfigManager,
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
}
