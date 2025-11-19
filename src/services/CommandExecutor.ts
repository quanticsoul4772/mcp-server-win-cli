import { spawn } from 'child_process';
import { canonicalizePath, isPathAllowed } from '../utils/validation.js';
import { sanitizePathError, createUserFriendlyError } from '../utils/errorSanitizer.js';
import type { ServerConfig } from '../types/config.js';
import { EnvironmentManager } from './EnvironmentManager.js';

/**
 * Result of command execution
 */
export interface CommandExecutionResult {
  output: string;
  error: string;
  exitCode: number;
  workingDirectory: string;
}

/**
 * Command execution options
 */
export interface CommandExecutionOptions {
  shell: keyof ServerConfig['shells'];
  command: string;
  workingDir?: string;
  timeout?: number;
  /**
   * Custom environment variables to set for this command
   * These are merged with system env and shell defaults
   */
  env?: Record<string, string>;
}

/**
 * CommandExecutor Service
 *
 * Handles the execution of shell commands with:
 * - Working directory validation and canonicalization
 * - Process spawning with timeout management
 * - Output and error stream capture
 * - Exit code tracking
 * - Path sanitization in errors
 *
 * @example
 * ```typescript
 * const executor = new CommandExecutor(config, allowedPaths, configPath);
 * const result = await executor.execute({
 *   shell: 'powershell',
 *   command: 'Get-Process',
 *   workingDir: 'C:\\Users\\user',
 *   timeout: 30
 * });
 * console.log(result.output);
 * ```
 */
export class CommandExecutor {
  constructor(
    private readonly config: ServerConfig,
    private readonly allowedPaths: string[],
    private readonly configPath: string | null
  ) {}

  /**
   * Validate and canonicalize working directory
   *
   * @param workingDir - Directory to validate (optional, defaults to cwd)
   * @param userProvidedPath - Original path from user for error sanitization
   * @returns Canonical absolute path
   * @throws Error if directory invalid or not allowed
   */
  private async validateWorkingDirectory(
    workingDir: string | undefined,
    userProvidedPath?: string
  ): Promise<string> {
    // Default to current working directory
    let dir = workingDir || process.cwd();

    // Canonicalize the path to resolve symlinks, junctions, and relative paths
    dir = canonicalizePath(dir);

    const fs = await import('fs');

    // Verify directory exists and is accessible
    const stats = fs.statSync(dir);
    if (!stats.isDirectory()) {
      throw new Error(
        `Working directory path is not a directory: ${sanitizePathError(dir, userProvidedPath)}`
      );
    }

    // Get the real path (prevents symlink attacks - TOCTOU protection)
    const realPath = fs.realpathSync(dir);

    // Check if path is allowed (if restriction enabled)
    if (this.config.security.restrictWorkingDirectory) {
      if (!isPathAllowed(realPath, this.allowedPaths)) {
        throw new Error(
          `Working directory is not in allowed paths. Use check_security_config tool to view allowed directories.`
        );
      }
    }

    return realPath;
  }

  /**
   * Execute a shell command
   *
   * @param options - Command execution options
   * @returns Promise resolving to command execution result
   * @throws Error if execution fails
   */
  async execute(options: CommandExecutionOptions): Promise<CommandExecutionResult> {
    const { shell, command, workingDir: userWorkingDir, timeout, env: userEnv } = options;

    // Validate and canonicalize working directory
    const workingDir = await this.validateWorkingDirectory(userWorkingDir, userWorkingDir);

    const shellConfig = this.config.shells[shell];
    const timeoutSeconds = timeout || this.config.security.commandTimeout;

    // Merge environment variables: system < shell defaults < user overrides
    const envManager = new EnvironmentManager(
      null, // ConfigManager not needed for merge
      this.config.security.blockedEnvVars || EnvironmentManager.getDefaultBlockedEnvVars(),
      this.config.security.allowedEnvVars
    );

    const mergedEnv = envManager.mergeEnvironmentVariables(
      shellConfig.defaultEnv,
      userEnv
    );

    return new Promise((resolve, reject) => {
      let shellProcess: ReturnType<typeof spawn>;

      // Spawn shell process with merged environment
      try {
        shellProcess = spawn(
          shellConfig.command,
          [...shellConfig.args, command],
          {
            cwd: workingDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: mergedEnv
          }
        );
      } catch (err) {
        reject(new Error(
          `Failed to start shell process: ${createUserFriendlyError(err)}. Consult the server admin for configuration changes.`
        ));
        return;
      }

      // Verify streams initialized
      if (!shellProcess.stdout || !shellProcess.stderr) {
        reject(new Error('Failed to initialize shell process streams'));
        return;
      }

      let output = '';
      let error = '';

      // Capture stdout
      shellProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      // Capture stderr
      shellProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      // Handle process completion
      shellProcess.on('close', (code) => {
        clearTimeout(timeoutHandle);

        resolve({
          output,
          error,
          exitCode: code ?? -1,
          workingDirectory: workingDir
        });
      });

      // Handle process errors (e.g., shell crashes)
      shellProcess.on('error', (err) => {
        clearTimeout(timeoutHandle);
        const sanitizedError = createUserFriendlyError(err);
        reject(new Error(`Shell process error: ${sanitizedError}`));
      });

      // Set timeout to prevent hanging
      const timeoutHandle = setTimeout(() => {
        shellProcess.kill();
        const timeoutMessage = timeout
          ? `Command execution timed out after ${timeoutSeconds} seconds (custom timeout).`
          : `Command execution timed out after ${timeoutSeconds} seconds (default timeout). Use 'timeout' parameter to extend.`;
        reject(new Error(timeoutMessage));
      }, timeoutSeconds * 1000);
    });
  }

  /**
   * Format execution result into human-readable message
   *
   * @param result - Command execution result
   * @param command - Original command string
   * @returns Formatted message string
   */
  formatResult(result: CommandExecutionResult, command: string): string {
    const { output, error, exitCode } = result;

    if (exitCode === 0) {
      return output || 'Command completed successfully (no output)';
    }

    let message = `Command failed with exit code ${exitCode}\n`;
    if (error) {
      message += `Error output:\n${error}\n`;
    }
    if (output) {
      message += `Standard output:\n${output}`;
    }
    if (!error && !output) {
      message += 'No error message or output was provided';
    }

    return message;
  }
}
