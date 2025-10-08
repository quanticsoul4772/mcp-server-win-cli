import type { ServerConfig } from '../types/config.js';

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
  ) {}

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
}
