export interface SecurityConfig {
  maxCommandLength: number;
  blockedCommands: string[];
  blockedArguments: string[];
  allowedPaths: string[];
  restrictWorkingDirectory: boolean;
  logCommands: boolean;
  maxHistorySize: number;
  commandTimeout: number;
  // enableInjectionProtection removed - always enforced for security

  /**
   * Environment variables blocked from being set (security)
   * Prevents credential leakage and privilege escalation
   */
  blockedEnvVars?: string[];

  /**
   * If set, ONLY these environment variables can be modified
   * If undefined, blocklist mode is used
   */
  allowedEnvVars?: string[];

  /**
   * Maximum number of custom environment variables per command
   * Default: 20
   */
  maxCustomEnvVars?: number;

  /**
   * Maximum length of environment variable values in bytes
   * Default: 32768
   */
  maxEnvVarValueLength?: number;
}

export interface ShellConfig {
  enabled: boolean;
  command: string;
  args: string[];
  validatePath?: (dir: string) => boolean;
  blockedOperators?: string[]; // Added for shell-specific operator restrictions
  /**
   * Default environment variables to set for this shell
   * Merged with system env and user-provided env vars
   */
  defaultEnv?: Record<string, string>;
}

/**
 * SSH connection configuration
 *
 * @remarks
 * At least one authentication method (password or privateKeyPath) is required.
 * This constraint is enforced at runtime by SSHConnectionConfigSchema validation.
 */
export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  /** Path to SSH private key file. Required if password is not provided. */
  privateKeyPath?: string;
  /** Password for SSH authentication. Required if privateKeyPath is not provided. */
  password?: string;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
  readyTimeout?: number;
}

export interface SSHConfig {
  enabled: boolean;
  connections: Record<string, SSHConnectionConfig>;
  defaultTimeout: number;
  maxConcurrentSessions: number;
  keepaliveInterval: number;
  keepaliveCountMax: number;
  readyTimeout: number;
  /**
   * Enable strict host key checking to prevent MITM attacks.
   * - true (default): Reject connections to unknown hosts
   * - false: Use Trust On First Use (TOFU) - accept and store new host keys
   */
  strictHostKeyChecking: boolean;
}

export interface ServerConfig {
  security: SecurityConfig;
  shells: {
    powershell: ShellConfig;
    cmd: ShellConfig;
    gitbash: ShellConfig;
  };
  ssh: SSHConfig;
}

export interface CommandHistoryEntry {
  command: string;
  output: string;
  timestamp: string;
  exitCode: number;
  connectionId?: string;
}