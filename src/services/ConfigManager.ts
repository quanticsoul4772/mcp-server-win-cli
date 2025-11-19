import type { ServerConfig } from '../types/config.js';
import { EnvironmentManager } from './EnvironmentManager.js';

/**
 * ConfigManager Service
 *
 * Manages server configuration with:
 * - Centralized config access
 * - Type-safe getters
 * - Config validation
 * - Path tracking
 *
 * @example
 * ```typescript
 * const configMgr = new ConfigManager(config, '/path/to/config.json');
 *
 * // Access config sections
 * const security = configMgr.getSecurity();
 * const shells = configMgr.getShells();
 *
 * // Get config path
 * const path = configMgr.getConfigPath();
 * ```
 */
export class ConfigManager {
  constructor(
    private readonly config: ServerConfig,
    private readonly configPath: string | null
  ) {
    // Validate defaultEnv at config load time
    this.validateDefaultEnv();
  }

  /**
   * Validate all shell defaultEnv configurations
   * Consolidates name validation (blocklist) and value validation (length, null bytes, control chars)
   *
   * @throws Error if any defaultEnv contains invalid variables
   */
  private validateDefaultEnv(): void {
    const blockedEnvVars = new Set(
      (this.config.security.blockedEnvVars || EnvironmentManager.getDefaultBlockedEnvVars())
        .map(v => v.toUpperCase())
    );
    const maxLength = this.config.security.maxEnvVarValueLength ||
      EnvironmentManager.getDefaultMaxEnvVarValueLength();

    // Regex for dangerous control characters (same as EnvironmentManager)
    const dangerousChars = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

    for (const [shellName, shellConfig] of Object.entries(this.config.shells)) {
      if (!shellConfig.defaultEnv) continue;

      for (const [envVarName, value] of Object.entries(shellConfig.defaultEnv)) {
        const upperName = envVarName.toUpperCase();

        // Validate name: exact match against blocklist
        if (blockedEnvVars.has(upperName)) {
          throw new Error(
            `Configuration error: Shell "${shellName}" defaultEnv contains blocked ` +
            `environment variable "${envVarName}". Remove it from defaultEnv or ` +
            `remove "${envVarName}" from security.blockedEnvVars.`
          );
        }

        // Validate name: pattern match against blocklist
        for (const blocked of blockedEnvVars) {
          if (upperName.includes(blocked)) {
            throw new Error(
              `Configuration error: Shell "${shellName}" defaultEnv variable ` +
              `"${envVarName}" matches blocked pattern "${blocked}". ` +
              `Remove it from defaultEnv or update security.blockedEnvVars.`
            );
          }
        }

        // Validate value: length check
        if (value.length > maxLength) {
          throw new Error(
            `Configuration error: Shell "${shellName}" defaultEnv variable ` +
            `"${envVarName}" value exceeds maximum length (${value.length} > ${maxLength}).`
          );
        }

        // Validate value: null bytes
        if (value.includes('\0')) {
          throw new Error(
            `Configuration error: Shell "${shellName}" defaultEnv variable ` +
            `"${envVarName}" contains null bytes which are not allowed.`
          );
        }

        // Validate value: dangerous control characters
        if (dangerousChars.test(value)) {
          throw new Error(
            `Configuration error: Shell "${shellName}" defaultEnv variable ` +
            `"${envVarName}" contains dangerous control characters.`
          );
        }
      }
    }
  }

  /**
   * Get the full server configuration
   *
   * @returns Complete server configuration
   */
  getConfig(): ServerConfig {
    return this.config;
  }

  /**
   * Get security configuration
   *
   * @returns Security config section
   */
  getSecurity() {
    return this.config.security;
  }

  /**
   * Get shell configurations
   *
   * @returns All shell configs
   */
  getShells() {
    return this.config.shells;
  }

  /**
   * Get SSH configuration
   *
   * @returns SSH config section
   */
  getSSH() {
    return this.config.ssh;
  }

  /**
   * Get configuration file path (if loaded from file)
   *
   * @returns Path to config file or null if using defaults
   */
  getConfigPath(): string | null {
    return this.configPath;
  }

  /**
   * Get enabled shell names
   *
   * @returns Array of enabled shell names
   */
  getEnabledShells(): string[] {
    return Object.entries(this.config.shells)
      .filter(([_, config]) => config.enabled)
      .map(([name, _]) => name);
  }

  /**
   * Get allowed paths from security config
   *
   * @returns Array of allowed paths
   */
  getAllowedPaths(): string[] {
    return this.config.security.allowedPaths;
  }

  /**
   * Get blocked commands from security config
   *
   * @returns Array of blocked command names
   */
  getBlockedCommands(): string[] {
    return this.config.security.blockedCommands;
  }

  /**
   * Check if a specific shell is enabled
   *
   * @param shellName - Shell name to check
   * @returns True if enabled, false otherwise
   */
  isShellEnabled(shellName: string): boolean {
    const shellKey = shellName as keyof typeof this.config.shells;
    return this.config.shells[shellKey]?.enabled ?? false;
  }

  /**
   * Check if command history logging is enabled
   *
   * @returns True if logging enabled
   */
  isHistoryLoggingEnabled(): boolean {
    return this.config.security.logCommands;
  }

  /**
   * Get command timeout in seconds
   *
   * @returns Timeout value
   */
  getCommandTimeout(): number {
    return this.config.security.commandTimeout;
  }

  /**
   * Get maximum history size
   *
   * @returns Max history entries
   */
  getMaxHistorySize(): number {
    return this.config.security.maxHistorySize;
  }

  /**
   * Get a specific config value by path (dot notation)
   *
   * @param path - Configuration path (e.g., 'security.maxCommandLength')
   * @returns Config value at path or undefined if not found
   *
   * @example
   * ```typescript
   * const timeout = configManager.getConfigValue('security.commandTimeout');
   * const shellEnabled = configManager.getConfigValue('shells.powershell.enabled');
   * ```
   */
  getConfigValue(path: string): any {
    const parts = path.split('.');
    let value: any = this.config;

    for (const part of parts) {
      if (value === undefined || value === null) {
        return undefined;
      }
      value = value[part];
    }

    return value;
  }
}
