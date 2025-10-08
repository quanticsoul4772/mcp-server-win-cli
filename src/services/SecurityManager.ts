import {
  isCommandBlocked,
  isArgumentBlocked,
  parseCommand,
  extractCommandName,
  validateShellOperators,
  getBlockedCommandName,
  getBlockedArgument
} from '../utils/validation.js';
import type { ServerConfig, ShellConfig } from '../types/config.js';

/**
 * SecurityManager Service
 *
 * Orchestrates all security validation with:
 * - Multi-stage validation pipeline
 * - Shell operator blocking
 * - Command and argument filtering
 * - Length restrictions
 * - Comprehensive error messages
 *
 * @example
 * ```typescript
 * const security = new SecurityManager(config, blockedCommands, configPath);
 *
 * // Validate command
 * security.validateCommand('powershell', 'Get-Process');
 * // Throws error if validation fails
 * ```
 */
export class SecurityManager {
  constructor(
    private readonly config: ServerConfig,
    private readonly blockedCommands: Set<string>,
    private readonly configPath: string | null
  ) {}

  /**
   * Validate a command through multi-stage security pipeline
   *
   * Validation stages:
   * 1. Shell operator validation
   * 2. Command parsing
   * 3. Command name blocking
   * 4. Argument blocking
   * 5. Length check
   *
   * @param shellKey - Shell to execute in
   * @param command - Command string to validate
   * @throws Error if validation fails at any stage
   */
  validateCommand(shellKey: keyof ServerConfig['shells'], command: string): void {
    const shellConfig = this.config.shells[shellKey];

    // Stage 1: Validate shell operators (pipes, redirects, etc.)
    validateShellOperators(command, shellConfig, this.configPath);

    // Stage 2: Parse command into name and arguments
    const parsed = parseCommand(command);
    const commandName = extractCommandName(parsed.command);

    // Stage 3: Check if command is blocked
    const blockedCommandsArray = Array.from(this.blockedCommands);
    if (isCommandBlocked(commandName, blockedCommandsArray)) {
      const blockedName = getBlockedCommandName(commandName, blockedCommandsArray);
      throw new Error(
        `Command '${blockedName}' is blocked by security policy. ` +
        `Use the check_security_config tool to view blocked commands.`
      );
    }

    // Stage 4: Check if any argument contains blocked patterns
    if (isArgumentBlocked(parsed.args, this.config.security.blockedArguments)) {
      const blockedArg = getBlockedArgument(parsed.args, this.config.security.blockedArguments);
      throw new Error(
        `Argument contains blocked pattern '${blockedArg}'. ` +
        `Use the check_security_config tool to view blocked argument patterns.`
      );
    }

    // Stage 5: Check command length
    if (command.length > this.config.security.maxCommandLength) {
      throw new Error(
        `Command exceeds maximum length of ${this.config.security.maxCommandLength} characters ` +
        `(actual: ${command.length}). ` +
        `This protects against buffer overflow and resource exhaustion attacks.`
      );
    }
  }

  /**
   * Get security configuration summary
   *
   * @returns Object with security settings
   */
  getConfig() {
    return {
      maxCommandLength: this.config.security.maxCommandLength,
      blockedCommands: Array.from(this.blockedCommands),
      blockedArguments: this.config.security.blockedArguments,
      allowedPaths: this.config.security.allowedPaths,
      restrictWorkingDirectory: this.config.security.restrictWorkingDirectory,
      commandTimeout: this.config.security.commandTimeout,
      shells: Object.entries(this.config.shells).map(([name, config]) => ({
        name,
        enabled: config.enabled,
        blockedOperators: config.blockedOperators || []
      }))
    };
  }

  /**
   * Get shell configuration for a specific shell
   *
   * @param shellKey - Shell name
   * @returns Shell configuration
   */
  getShellConfig(shellKey: keyof ServerConfig['shells']): ShellConfig {
    return this.config.shells[shellKey];
  }

  /**
   * Get list of enabled shells
   *
   * @returns Array of enabled shell names
   */
  getEnabledShells(): string[] {
    return Object.entries(this.config.shells)
      .filter(([_, config]) => config.enabled)
      .map(([name, _]) => name);
  }
}
