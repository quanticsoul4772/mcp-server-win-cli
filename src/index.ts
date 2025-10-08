#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  isCommandBlocked,
  isArgumentBlocked,
  parseCommand,
  extractCommandName,
  validateShellOperators,
  canonicalizePath,
  isPathAllowed
} from './utils/validation.js';
import { spawn } from 'child_process';
import { z } from 'zod';
import path from 'path';
import { loadConfig, createDefaultConfig } from './utils/config.js';
import type { ServerConfig, CommandHistoryEntry, SSHConnectionConfig } from './types/config.js';
import { SSHConnectionPool } from './utils/ssh.js';
import { createRequire } from 'module';
import { createSSHConnection, readSSHConnections, updateSSHConnection, deleteSSHConnection } from './utils/sshManager.js';
import { sanitizeErrorMessage, createUserFriendlyError } from './utils/errorSanitizer.js';
import { SessionManager } from './utils/sessionManager.js';
const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

// Parse command line arguments using yargs
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

const parseArgs = async () => {
  return yargs(hideBin(process.argv))
    .option('config', {
      alias: 'c',
      type: 'string',
      description: 'Path to config file'
    })
    .option('init-config', {
      type: 'string',
      description: 'Create a default config file at the specified path'
    })
    .help()
    .parse();
};

class CLIServer {
  private server: Server;
  private allowedPaths: Set<string>;
  private blockedCommands: Set<string>;
  private commandHistory: CommandHistoryEntry[];
  private config: ServerConfig;
  private sshPool: SSHConnectionPool;
  private sessionManager: SessionManager;
  private historyCleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
    this.server = new Server({
      name: "windows-cli-server",
      version: packageJson.version,
    }, {
      capabilities: {
        tools: {},
        resources: {}  // Add resources capability
      }
    });

    // Initialize from config
    this.allowedPaths = new Set(config.security.allowedPaths);
    this.blockedCommands = new Set(config.security.blockedCommands);
    this.commandHistory = [];
    this.sshPool = new SSHConnectionPool();
    this.sessionManager = new SessionManager();

    this.setupHandlers();
    this.startHistoryCleanup();
  }

  private startHistoryCleanup(): void {
    // Run cleanup every 5 minutes
    this.historyCleanupTimer = setInterval(() => {
      if (this.commandHistory.length > this.config.security.maxHistorySize) {
        const excess = this.commandHistory.length - this.config.security.maxHistorySize;
        this.commandHistory.splice(0, excess);
        console.error(`Cleaned up ${excess} old command history entries`);
      }
    }, 5 * 60 * 1000);
  }

  private addToHistory(entry: CommandHistoryEntry): void {
    // Clean up immediately if at limit (prevents memory spikes)
    if (this.commandHistory.length >= this.config.security.maxHistorySize) {
      this.commandHistory.shift(); // Remove oldest entry
    }
    this.commandHistory.push(entry);
  }

  private validateCommand(shell: keyof ServerConfig['shells'], command: string): void {
    // Check for command chaining/injection attempts (always enforced)
    // Get shell-specific config
    const shellConfig = this.config.shells[shell];

    // Use shell-specific operator validation
    try {
      validateShellOperators(command, shellConfig);
    } catch (error) {
      const blockedOps = shellConfig.blockedOperators?.join(', ') || 'none';
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Command contains blocked operator. Blocked operators: ${blockedOps}. Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const { command: executable, args } = parseCommand(command);

    // Check for blocked commands
    if (isCommandBlocked(executable, Array.from(this.blockedCommands))) {
      const cmdName = extractCommandName(executable);
      const blockedList = Array.from(this.blockedCommands).slice(0, 10).join(', ');
      const more = this.blockedCommands.size > 10 ? ` and ${this.blockedCommands.size - 10} more` : '';
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Command '${cmdName}' is blocked by security policy. Blocked commands: ${blockedList}${more}`
      );
    }

    // Check for blocked arguments
    if (isArgumentBlocked(args, this.config.security.blockedArguments)) {
      const blockedArgs = this.config.security.blockedArguments.slice(0, 10).join(', ');
      const more = this.config.security.blockedArguments.length > 10 ? ` and ${this.config.security.blockedArguments.length - 10} more` : '';
      throw new McpError(
        ErrorCode.InvalidRequest,
        `One or more arguments are blocked by security policy. Blocked arguments: ${blockedArgs}${more}`
      );
    }

    // Validate command length
    if (command.length > this.config.security.maxCommandLength) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Command exceeds maximum length of ${this.config.security.maxCommandLength} characters (current: ${command.length})`
      );
    }
  }

  /**
   * Escapes special characters in a string for use in a regular expression
   * @param text The string to escape
   * @returns The escaped string
   */
  private escapeRegex(text: string): string {
    return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  }

  private setupHandlers(): void {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const sshConnections = readSSHConnections() as Record<string, any>;
      
      // Create resources for each SSH connection
      const resources = Object.entries(sshConnections).map(([id, config]) => ({
        uri: `ssh://${id}`,
        name: `SSH Connection: ${id}`,
        description: `SSH connection to ${config.host}:${config.port} as ${config.username}`,
        mimeType: "application/json"
      }));
      
      // Add a resource for the current working directory
      resources.push({
        uri: "cli://currentdir",
        name: "Current Working Directory",
        description: "The current working directory of the CLI server",
        mimeType: "text/plain"
      });
      
      // Add a resource for SSH configuration
      resources.push({
        uri: "ssh://config",
        name: "SSH Configuration",
        description: "All SSH connection configurations",
        mimeType: "application/json"
      });

      // Add a resource for CLI configuration
      resources.push({
        uri: "cli://config",
        name: "CLI Server Configuration",
        description: "Main CLI server configuration (excluding sensitive data)",
        mimeType: "application/json"
      });
      
      return { resources };
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      
      // Handle SSH connection resources
      if (uri.startsWith("ssh://") && uri !== "ssh://config") {
        const connectionId = uri.slice(6); // Remove "ssh://" prefix
        const connections = readSSHConnections() as Record<string, any>;
        const connectionConfig = connections[connectionId];
        
        if (!connectionConfig) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown SSH connection: ${connectionId}`
          );
        }
        
        // Return connection details (excluding sensitive info)
        const safeConfig = { ...connectionConfig };
        
        // Remove sensitive information
        if (safeConfig.password) {
          safeConfig.password = "********";
        }
        
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(safeConfig, null, 2)
          }]
        };
      }
      
      // Handle SSH configuration resource
      if (uri === "ssh://config") {
        const connections = readSSHConnections() as Record<string, any>;
        const safeConnections = { ...connections };
        
        // Remove sensitive information from all connections
        for (const connection of Object.values(safeConnections)) {
          if (connection.password) {
            connection.password = "********";
          }
        }
        
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              enabled: this.config.ssh.enabled,
              defaultTimeout: this.config.ssh.defaultTimeout,
              maxConcurrentSessions: this.config.ssh.maxConcurrentSessions,
              connections: safeConnections
            }, null, 2)
          }]
        };
      }
      
      // Handle current directory resource
      if (uri === "cli://currentdir") {
        const currentDir = process.cwd();
        return {
          contents: [{
            uri,
            mimeType: "text/plain",
            text: currentDir
          }]
        };
      }
      
      // Handle CLI configuration resource
      if (uri === "cli://config") {
        // Create a safe copy of config (excluding sensitive information)
        const safeConfig = {
          security: {
            ...this.config.security,
          },
          shells: {
            ...this.config.shells
          },
          ssh: {
            enabled: this.config.ssh.enabled,
            defaultTimeout: this.config.ssh.defaultTimeout,
            maxConcurrentSessions: this.config.ssh.maxConcurrentSessions,
            connections: Object.keys(this.config.ssh.connections).length
          }
        };
        
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(safeConfig, null, 2)
          }]
        };
      }
      
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unknown resource URI: ${uri}`
      );
    });

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "execute_command",
          description: `Execute a command in the specified shell (powershell, cmd, or gitbash)

Example usage (PowerShell):
\`\`\`json
{
  "shell": "powershell",
  "command": "Get-Process | Select-Object -First 5",
  "workingDir": "C:\\Users\\username"
}
\`\`\`

Example usage (CMD):
\`\`\`json
{
  "shell": "cmd",
  "command": "dir /b",
  "workingDir": "C:\\Projects"
}
\`\`\`

Example usage (Git Bash):
\`\`\`json
{
  "shell": "gitbash",
  "command": "ls -la",
  "workingDir": "/c/Users/username"
}
\`\`\``,
          inputSchema: {
            type: "object",
            properties: {
              shell: {
                type: "string",
                enum: Object.keys(this.config.shells).filter(shell => 
                  this.config.shells[shell as keyof typeof this.config.shells].enabled
                ),
                description: "Shell to use for command execution"
              },
              command: {
                type: "string",
                description: "Command to execute"
              },
              workingDir: {
                type: "string",
                description: "Working directory for command execution (optional)"
              },
              timeout: {
                type: "number",
                description: "Command timeout in seconds (overrides config default)"
              }
            },
            required: ["shell", "command"]
          }
        },
        {
          name: "read_command_history",
          description: `Get the history of executed commands

Example usage:
\`\`\`json
{
  "limit": 5
}
\`\`\`

Example response:
\`\`\`json
[
  {
    "command": "Get-Process",
    "output": "...",
    "timestamp": "2024-03-20T10:30:00Z",
    "exitCode": 0
  }
]
\`\`\``,
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: `Maximum number of history entries to return (default: 10, max: ${this.config.security.maxHistorySize})`
              }
            }
          }
        },
        {
          name: "ssh_execute",
          description: `Execute a command on a remote host via SSH

Example usage:
\`\`\`json
{
  "connectionId": "raspberry-pi",
  "command": "uname -a"
}
\`\`\`

Configuration required in config.json:
\`\`\`json
{
  "ssh": {
    "enabled": true,
    "connections": {
      "raspberry-pi": {
        "host": "raspberrypi.local",
        "port": 22,
        "username": "pi",
        "password": "raspberry"
      }
    }
  }
}
\`\`\``,
          inputSchema: {
            type: "object",
            properties: {
              connectionId: {
                type: "string",
                description: "ID of the SSH connection to use",
                enum: Object.keys(this.config.ssh.connections)
              },
              command: {
                type: "string",
                description: "Command to execute"
              }
            },
            required: ["connectionId", "command"]
          }
        },
        {
          name: "ssh_disconnect",
          description: `Disconnect from an SSH server

Example usage:
\`\`\`json
{
  "connectionId": "raspberry-pi"
}
\`\`\`

Use this to cleanly close SSH connections when they're no longer needed.`,
          inputSchema: {
            type: "object",
            properties: {
              connectionId: {
                type: "string",
                description: "ID of the SSH connection to disconnect",
                enum: Object.keys(this.config.ssh.connections)
              }
            },
            required: ["connectionId"]
          }
        },
        {
          name: "create_ssh_connection",
          description: "Create a new SSH connection",
          inputSchema: {
            type: "object",
            properties: {
              connectionId: {
                type: "string",
                description: "ID of the SSH connection"
              },
              connectionConfig: {
                type: "object",
                properties: {
                  host: {
                    type: "string",
                    description: "Host of the SSH connection"
                  },
                  port: {
                    type: "number",
                    description: "Port of the SSH connection"
                  },
                  username: {
                    type: "string",
                    description: "Username for the SSH connection"
                  },
                  password: {
                    type: "string",
                    description: "Password for the SSH connection"
                  },
                  privateKeyPath: {
                    type: "string",
                    description: "Path to the private key for the SSH connection"
                  }
                },
                required: ["connectionId", "connectionConfig"]
              }
            }
          }
        },
        {
          name: "read_ssh_connections",
          description: "Read all SSH connections",
          inputSchema: {
            type: "object",
            properties: {} // No input parameters needed
          }
        },
        {
          name: "update_ssh_connection",
          description: "Update an existing SSH connection",
          inputSchema: {
            type: "object",
            properties: {
              connectionId: {
                type: "string",
                description: "ID of the SSH connection to update"
              },
              connectionConfig: {
                type: "object",
                properties: {
                  host: {
                    type: "string",
                    description: "Host of the SSH connection"
                  },
                  port: {
                    type: "number",
                    description: "Port of the SSH connection"
                  },
                  username: {
                    type: "string",
                    description: "Username for the SSH connection"
                  },
                  password: {
                    type: "string",
                    description: "Password for the SSH connection"
                  },
                  privateKeyPath: {
                    type: "string",
                    description: "Path to the private key for the SSH connection"
                  }
                },
                required: ["connectionId", "connectionConfig"]
              }
            }
          }
        },
        {
          name: "delete_ssh_connection",
          description: "Delete an existing SSH connection",
          inputSchema: {
            type: "object",
            properties: {
              connectionId: {
                type: "string",
                description: "ID of the SSH connection to delete"
              }
            },
            required: ["connectionId"]
          }
        },
        {
          name: "read_current_directory",
          description: "Get the current working directory",
          inputSchema: {
            type: "object",
            properties: {} // No input parameters needed
          }
        },
        {
          name: "read_ssh_pool_status",
          description: "Get the status and health of the SSH connection pool",
          inputSchema: {
            type: "object",
            properties: {} // No input parameters needed
          }
        },
        {
          name: "check_security_config",
          description: "Get current security configuration including blocked commands, allowed paths, and restrictions",
          inputSchema: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["all", "commands", "paths", "operators", "limits"],
                description: "Filter by configuration category (optional, default: all)"
              }
            }
          }
        },
        {
          name: "validate_command",
          description: "Check if a command would be allowed without executing it (dry-run validation)",
          inputSchema: {
            type: "object",
            properties: {
              shell: {
                type: "string",
                enum: Object.keys(this.config.shells).filter(shell =>
                  this.config.shells[shell as keyof typeof this.config.shells].enabled
                ),
                description: "Shell to validate against"
              },
              command: {
                type: "string",
                description: "Command to validate"
              },
              workingDir: {
                type: "string",
                description: "Working directory to validate (optional)"
              }
            },
            required: ["shell", "command"]
          }
        },
        {
          name: "validate_ssh_connection",
          description: "Validate SSH connection configuration and test connectivity",
          inputSchema: {
            type: "object",
            properties: {
              connectionConfig: {
                type: "object",
                properties: {
                  host: {
                    type: "string",
                    description: "Host of the SSH connection"
                  },
                  port: {
                    type: "number",
                    description: "Port of the SSH connection"
                  },
                  username: {
                    type: "string",
                    description: "Username for the SSH connection"
                  },
                  password: {
                    type: "string",
                    description: "Password for the SSH connection"
                  },
                  privateKeyPath: {
                    type: "string",
                    description: "Path to the private key for the SSH connection"
                  }
                },
                required: ["host", "port", "username"]
              }
            },
            required: ["connectionConfig"]
          }
        },
      ]
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case "execute_command": {
            let args;
            try {
              args = z.object({
                shell: z.enum(Object.keys(this.config.shells).filter(shell =>
                  this.config.shells[shell as keyof typeof this.config.shells].enabled
                ) as [string, ...string[]]),
                command: z.string(),
                workingDir: z.string().optional(),
                timeout: z.number().positive().optional()
              }).parse(request.params.arguments);
            } catch (err) {
              if (err instanceof z.ZodError) {
                const availableShells = Object.keys(this.config.shells).filter(shell =>
                  this.config.shells[shell as keyof typeof this.config.shells].enabled
                ).join(', ');
                throw new McpError(
                  ErrorCode.InvalidParams,
                  `Invalid parameters. Available shells: ${availableShells}. ${err.errors.map(e => e.message).join(', ')}`
                );
              }
              throw err;
            }

            // Validate command
            try {
              this.validateCommand(args.shell as keyof ServerConfig['shells'], args.command);
            } catch (error) {
              // Log validation failures to history
              if (this.config.security.logCommands && error instanceof McpError) {
                this.addToHistory({
                  command: args.command,
                  output: `BLOCKED: ${error.message}`,
                  timestamp: new Date().toISOString(),
                  exitCode: -2 // -2 = validation failure
                });
              }
              throw error;
            }

            // Validate and canonicalize working directory if provided
            let workingDir = args.workingDir ?
              args.workingDir :
              process.cwd();

            // Canonicalize the path to resolve symlinks, junctions, and relative paths
            workingDir = canonicalizePath(workingDir);

            const shellKey = args.shell as keyof typeof this.config.shells;
            const shellConfig = this.config.shells[shellKey];

            // Validate working directory to prevent TOCTOU race condition
            try {
              const fs = await import('fs');

              // Verify directory exists and is accessible
              const stats = fs.statSync(workingDir);
              if (!stats.isDirectory()) {
                throw new McpError(
                  ErrorCode.InvalidRequest,
                  `Working directory path is not a directory: ${workingDir}`
                );
              }

              // Get the real path (prevents symlink attacks)
              const realPath = fs.realpathSync(workingDir);

              if (this.config.security.restrictWorkingDirectory) {
                if (!isPathAllowed(realPath, Array.from(this.allowedPaths))) {
                  const allowedList = Array.from(this.allowedPaths).slice(0, 5).join(', ');
                  const more = this.allowedPaths.size > 5 ? ` and ${this.allowedPaths.size - 5} more` : '';
                  throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Working directory '${realPath}' is not in allowed paths. Allowed paths: ${allowedList}${more}. To modify, update config.json: security.allowedPaths or set security.restrictWorkingDirectory to false.`
                  );
                }
              }

              // Use the verified real path for execution
              workingDir = realPath;
            } catch (err) {
              if (err instanceof McpError) {
                throw err;
              }
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Invalid working directory: ${createUserFriendlyError(err)}`
              );
            }

            // Execute command
            return new Promise((resolve, reject) => {
              let shellProcess: ReturnType<typeof spawn>;

              try {
                shellProcess = spawn(
                  shellConfig.command,
                  [...shellConfig.args, args.command],
                  { cwd: workingDir, stdio: ['pipe', 'pipe', 'pipe'] }
                );
              } catch (err) {
                throw new McpError(
                  ErrorCode.InternalError,
                  `Failed to start shell process: ${createUserFriendlyError(err)}. Consult the server admin for configuration changes.`
                );
              }

              if (!shellProcess.stdout || !shellProcess.stderr) {
                throw new McpError(
                  ErrorCode.InternalError,
                  'Failed to initialize shell process streams'
                );
              }

              let output = '';
              let error = '';

              shellProcess.stdout.on('data', (data) => {
                output += data.toString();
              });

              shellProcess.stderr.on('data', (data) => {
                error += data.toString();
              });

              shellProcess.on('close', (code) => {
                // Prepare detailed result message
                let resultMessage = '';
                
                if (code === 0) {
                  resultMessage = output || 'Command completed successfully (no output)';
                } else {
                  resultMessage = `Command failed with exit code ${code}\n`;
                  if (error) {
                    resultMessage += `Error output:\n${error}\n`;
                  }
                  if (output) {
                    resultMessage += `Standard output:\n${output}`;
                  }
                  if (!error && !output) {
                    resultMessage += 'No error message or output was provided';
                  }
                }

                // Store in history if enabled
                if (this.config.security.logCommands) {
                  this.addToHistory({
                    command: args.command,
                    output: resultMessage,
                    timestamp: new Date().toISOString(),
                    exitCode: code ?? -1
                  });
                }

                resolve({
                  content: [{
                    type: "text",
                    text: resultMessage
                  }],
                  isError: code !== 0,
                  metadata: {
                    exitCode: code ?? -1,
                    shell: args.shell,
                    workingDirectory: workingDir
                  }
                });
              });

              // Handle process errors (e.g., shell crashes)
              shellProcess.on('error', (err) => {
                const sanitizedError = createUserFriendlyError(err);
                const errorMessage = `Shell process error: ${sanitizedError}`;
                // Don't log to history - command never started
                reject(new McpError(
                  ErrorCode.InternalError,
                  errorMessage
                ));
              });

              // Set configurable timeout to prevent hanging
              const timeoutSeconds = args.timeout || this.config.security.commandTimeout;
              const timeout = setTimeout(() => {
                shellProcess.kill();
                const timeoutMessage = args.timeout
                  ? `Command execution timed out after ${timeoutSeconds} seconds (custom timeout).`
                  : `Command execution timed out after ${timeoutSeconds} seconds (default timeout). Use 'timeout' parameter to extend.`;
                if (this.config.security.logCommands) {
                  this.addToHistory({
                    command: args.command,
                    output: timeoutMessage,
                    timestamp: new Date().toISOString(),
                    exitCode: -1
                  });
                }
                reject(new McpError(
                  ErrorCode.InternalError,
                  timeoutMessage
                ));
              }, timeoutSeconds * 1000);

              shellProcess.on('close', () => clearTimeout(timeout));
            });
          }

          case "read_command_history": {
            if (!this.config.security.logCommands) {
              return {
                content: [{
                  type: "text",
                  text: "Command history is disabled in configuration. Consult the server admin for configuration changes (config.json - logCommands)."
                }]
              };
            }

            const args = z.object({
              limit: z.number()
                .min(1)
                .max(this.config.security.maxHistorySize)
                .optional()
                .default(10)
            }).parse(request.params.arguments);

            const history = this.commandHistory
              .slice(-args.limit)
              .map(entry => ({
                ...entry,
                output: entry.output.slice(0, 1000) // Limit output size
              }));

            return {
              content: [{
                type: "text",
                text: JSON.stringify(history, null, 2)
              }]
            };
          }

          case "ssh_execute": {
            if (!this.config.ssh.enabled) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                "SSH support is disabled in configuration"
              );
            }

            const args = z.object({
              connectionId: z.string(),
              command: z.string()
            }).parse(request.params.arguments);

            const connectionConfig = this.config.ssh.connections[args.connectionId];
            if (!connectionConfig) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Unknown SSH connection ID: ${args.connectionId}`
              );
            }

            try {
              // Get or establish connection first
              const connection = await this.sshPool.getConnection(args.connectionId, connectionConfig);

              // Detect the remote shell type synchronously (uses cached value if available)
              await connection.detectShellType();
              const remoteShellType = connection.getShellType();

              // Map remote shell type to local shell config for validation
              // Fail-closed: use most restrictive rules (cmd) for unknown shells
              let validationShell: keyof ServerConfig['shells'] = 'cmd';
              if (remoteShellType === 'bash' || remoteShellType === 'sh') {
                validationShell = 'gitbash';
              } else if (remoteShellType === 'powershell') {
                validationShell = 'powershell';
              }
              // If remoteShellType is 'unknown', use 'cmd' (most restrictive)

              // Validate command with appropriate shell context
              this.validateCommand(validationShell, args.command);

              const { output, exitCode } = await connection.executeCommand(args.command);

              // Store in history if enabled
              if (this.config.security.logCommands) {
                this.addToHistory({
                  command: args.command,
                  output,
                  timestamp: new Date().toISOString(),
                  exitCode,
                  connectionId: args.connectionId
                });
              }

              return {
                content: [{
                  type: "text",
                  text: output || 'Command completed successfully (no output)'
                }],
                isError: exitCode !== 0,
                metadata: {
                  exitCode,
                  connectionId: args.connectionId
                }
              };
            } catch (error) {
              const sanitizedError = createUserFriendlyError(error);
              if (this.config.security.logCommands) {
                this.addToHistory({
                  command: args.command,
                  output: `SSH error: ${sanitizedError}`,
                  timestamp: new Date().toISOString(),
                  exitCode: -1,
                  connectionId: args.connectionId
                });
              }
              throw new McpError(
                ErrorCode.InternalError,
                `SSH error: ${sanitizedError}`
              );
            }
          }

          case "ssh_disconnect": {
            if (!this.config.ssh.enabled) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                "SSH support is disabled in configuration"
              );
            }

            const args = z.object({
              connectionId: z.string()
            }).parse(request.params.arguments);

            await this.sshPool.closeConnection(args.connectionId);
            return {
              content: [{
                type: "text",
                text: `Disconnected from ${args.connectionId}`
              }]
            };
          }

          case 'create_ssh_connection': {
            const args = z.object({
              connectionId: z.string(),
              connectionConfig: z.object({
                host: z.string(),
                port: z.number(),
                username: z.string(),
                password: z.string().optional(),
                privateKeyPath: z.string().optional(),
              })
            }).parse(request.params.arguments);
            await createSSHConnection(args.connectionId, args.connectionConfig);
            return { content: [{ type: 'text', text: 'SSH connection created successfully.' }] };
          }

          case 'read_ssh_connections': {
            const connections = readSSHConnections();
            return { content: [{ type: 'text', text: JSON.stringify(connections, null, 2) }] };
          }

          case 'update_ssh_connection': {
            const args = z.object({
              connectionId: z.string(),
              connectionConfig: z.object({
                host: z.string(),
                port: z.number(),
                username: z.string(),
                password: z.string().optional(),
                privateKeyPath: z.string().optional(),
              })
            }).parse(request.params.arguments);
            await updateSSHConnection(args.connectionId, args.connectionConfig);
            return { content: [{ type: 'text', text: 'SSH connection updated successfully.' }] };
          }

          case 'delete_ssh_connection': {
            const args = z.object({
              connectionId: z.string(),
            }).parse(request.params.arguments);

            // Check if connection is active in pool
            if (this.sshPool.hasConnection(args.connectionId)) {
              await this.sshPool.closeConnection(args.connectionId);
            }

            await deleteSSHConnection(args.connectionId);
            return { content: [{ type: 'text', text: 'SSH connection deleted successfully.' }] };
          }

          case 'read_current_directory': {
            const currentDir = process.cwd();
            return { content: [{ type: 'text', text: `Current working directory: ${currentDir}` }] };
          }

          case 'read_ssh_pool_status': {
            if (!this.config.ssh.enabled) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                "SSH support is disabled in server configuration. To enable: set ssh.enabled = true in config.json"
              );
            }

            const poolStats = this.sshPool.getPoolStats();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(poolStats, null, 2)
              }]
            };
          }

          case 'check_security_config': {
            const args = z.object({
              category: z.enum(['all', 'commands', 'paths', 'operators', 'limits']).optional().default('all')
            }).parse(request.params.arguments);

            const config: any = {};

            if (args.category === 'all' || args.category === 'commands') {
              config.blocked_commands = Array.from(this.blockedCommands);
              config.blocked_arguments = this.config.security.blockedArguments;
            }

            if (args.category === 'all' || args.category === 'paths') {
              config.allowed_paths = Array.from(this.allowedPaths);
              config.restrict_working_directory = this.config.security.restrictWorkingDirectory;
            }

            if (args.category === 'all' || args.category === 'operators') {
              config.blocked_operators = {
                powershell: this.config.shells.powershell.blockedOperators || [],
                cmd: this.config.shells.cmd.blockedOperators || [],
                gitbash: this.config.shells.gitbash.blockedOperators || []
              };
            }

            if (args.category === 'all' || args.category === 'limits') {
              config.command_timeout_seconds = this.config.security.commandTimeout;
              config.max_command_length = this.config.security.maxCommandLength;
              config.max_history_size = this.config.security.maxHistorySize;
              config.log_commands = this.config.security.logCommands;
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(config, null, 2)
              }]
            };
          }

          case 'validate_command': {
            const args = z.object({
              shell: z.string(),
              command: z.string(),
              workingDir: z.string().optional()
            }).parse(request.params.arguments);

            const result: any = {
              valid: true,
              checks: {
                command_blocked: false,
                operator_blocked: false,
                argument_blocked: false,
                path_allowed: true,
                length_ok: true
              },
              warnings: [],
              errors: []
            };

            // Validate command without executing
            try {
              this.validateCommand(args.shell as keyof ServerConfig['shells'], args.command);
            } catch (error) {
              result.valid = false;
              if (error instanceof McpError) {
                result.errors.push(error.message);
                // Parse error type
                if (error.message.includes('blocked by security policy')) {
                  if (error.message.includes('Blocked commands:')) {
                    result.checks.command_blocked = true;
                  } else if (error.message.includes('Blocked arguments:')) {
                    result.checks.argument_blocked = true;
                  }
                } else if (error.message.includes('blocked operator')) {
                  result.checks.operator_blocked = true;
                } else if (error.message.includes('maximum length')) {
                  result.checks.length_ok = false;
                }
              }
            }

            // Check working directory if provided
            if (args.workingDir) {
              try {
                const fs = await import('fs');
                const realPath = fs.realpathSync(args.workingDir);
                if (this.config.security.restrictWorkingDirectory) {
                  if (!isPathAllowed(realPath, Array.from(this.allowedPaths))) {
                    result.valid = false;
                    result.checks.path_allowed = false;
                    result.errors.push(`Working directory '${realPath}' is not in allowed paths`);
                  }
                }
              } catch (err) {
                result.valid = false;
                result.checks.path_allowed = false;
                result.errors.push(`Invalid working directory: ${createUserFriendlyError(err)}`);
              }
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          }

          case 'validate_ssh_connection': {
            const args = z.object({
              connectionConfig: z.object({
                host: z.string(),
                port: z.number(),
                username: z.string(),
                password: z.string().optional(),
                privateKeyPath: z.string().optional(),
              })
            }).parse(request.params.arguments);

            // Validate authentication method
            if (!args.connectionConfig.password && !args.connectionConfig.privateKeyPath) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    valid: false,
                    errors: ['Either password or privateKeyPath must be provided']
                  }, null, 2)
                }],
                isError: true
              };
            }

            // Test connectivity
            try {
              const { SSHConnection } = await import('./utils/ssh.js');
              const testConnection = new SSHConnection(args.connectionConfig as SSHConnectionConfig);

              await testConnection.connect();
              const shellType = await testConnection.detectShellType();
              testConnection.disconnect();

              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    valid: true,
                    detectedShellType: shellType,
                    message: 'Connection successful'
                  }, null, 2)
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    valid: false,
                    errors: [createUserFriendlyError(error)]
                  }, null, 2)
                }],
                isError: true
              };
            }
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid arguments: ${error.errors.map(e => e.message).join(', ')}`
          );
        }
        throw error;
      }
    });
  }

  private async cleanup(): Promise<void> {
    // Clear history cleanup timer
    if (this.historyCleanupTimer) {
      clearInterval(this.historyCleanupTimer);
      this.historyCleanupTimer = null;
    }

    // Close all SSH connections
    this.sshPool.closeAll();

    // Cleanup sessions
    this.sessionManager.cleanup();
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    
    // Set up cleanup handler
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
    
    await this.server.connect(transport);
    console.error("Windows CLI MCP Server running on stdio");
  }
}

// Start server
const main = async () => {
  try {
    const args = await parseArgs();
    
    // Handle --init-config flag
    if (args['init-config']) {
      try {
        createDefaultConfig(args['init-config'] as string);
        console.error(`Created default config at: ${args['init-config']}`);
        process.exit(0);
      } catch (error) {
        console.error('Failed to create config file:', error);
        process.exit(1);
      }
    }

    // Load configuration
    const config = loadConfig(args.config);
    
    const server = new CLIServer(config);
    await server.run();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
};

main();