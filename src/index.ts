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
import { loadConfig, createDefaultConfig } from './utils/config.js';
import type { ServerConfig, CommandHistoryEntry } from './types/config.js';
import { SSHConnectionPool } from './utils/ssh.js';
import { createRequire } from 'module';
import { readSSHConnections } from './utils/sshManager.js';
import { ServiceContainer } from './server/ServiceContainer.js';
import { ToolRegistry } from './registries/ToolRegistry.js';
import { ConfigManager } from './services/ConfigManager.js';
import { SecurityManager } from './services/SecurityManager.js';
import { CommandExecutor } from './services/CommandExecutor.js';
import { HistoryManager } from './services/HistoryManager.js';
import { EnvironmentManager } from './services/EnvironmentManager.js';
import { JobManager } from './services/JobManager.js';
import { ExecuteCommandTool } from './tools/command/ExecuteCommandTool.js';
import { ReadCommandHistoryTool } from './tools/command/ReadCommandHistoryTool.js';
import { StartBackgroundJobTool } from './tools/command/StartBackgroundJobTool.js';
import { GetJobStatusTool } from './tools/command/GetJobStatusTool.js';
import { GetJobOutputTool } from './tools/command/GetJobOutputTool.js';
import { ExecuteBatchTool } from './tools/command/ExecuteBatchTool.js';
import { SSHExecuteTool } from './tools/ssh/SSHExecuteTool.js';
import { SSHDisconnectTool } from './tools/ssh/SSHDisconnectTool.js';
import { CreateSSHConnectionTool } from './tools/ssh/CreateSSHConnectionTool.js';
import { ReadSSHConnectionsTool } from './tools/ssh/ReadSSHConnectionsTool.js';
import { UpdateSSHConnectionTool } from './tools/ssh/UpdateSSHConnectionTool.js';
import { DeleteSSHConnectionTool } from './tools/ssh/DeleteSSHConnectionTool.js';
import { ReadSSHPoolStatusTool } from './tools/ssh/ReadSSHPoolStatusTool.js';
import { ValidateSSHConnectionTool } from './tools/ssh/ValidateSSHConnectionTool.js';
import { SFTPUploadTool } from './tools/ssh/SFTPUploadTool.js';
import { SFTPDownloadTool } from './tools/ssh/SFTPDownloadTool.js';
import { SFTPListDirectoryTool } from './tools/ssh/SFTPListDirectoryTool.js';
import { SFTPDeleteFileTool } from './tools/ssh/SFTPDeleteFileTool.js';
import { CheckSecurityConfigTool } from './tools/diagnostics/CheckSecurityConfigTool.js';
import { ValidateCommandTool } from './tools/diagnostics/ValidateCommandTool.js';
import { ExplainExitCodeTool } from './tools/diagnostics/ExplainExitCodeTool.js';
import { ValidateConfigTool } from './tools/diagnostics/ValidateConfigTool.js';
import { ReadSystemInfoTool } from './tools/diagnostics/ReadSystemInfoTool.js';
import { TestConnectionTool } from './tools/diagnostics/TestConnectionTool.js';
import { ReadEnvironmentVariableTool } from './tools/diagnostics/ReadEnvironmentVariableTool.js';
import { ListEnvironmentVariablesTool } from './tools/diagnostics/ListEnvironmentVariablesTool.js';
import { GetConfigValueTool } from './tools/diagnostics/GetConfigValueTool.js';
import { ReloadConfigTool } from './tools/diagnostics/ReloadConfigTool.js';
import { DnsLookupTool } from './tools/diagnostics/DnsLookupTool.js';
import { TestConnectivityTool } from './tools/diagnostics/TestConnectivityTool.js';
import { ReadCurrentDirectoryTool } from './tools/system/ReadCurrentDirectoryTool.js';
import { GetCpuUsageTool } from './tools/system/GetCpuUsageTool.js';
import { GetDiskSpaceTool } from './tools/system/GetDiskSpaceTool.js';
import { ListProcessesTool } from './tools/system/ListProcessesTool.js';
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
  private container: ServiceContainer;
  private toolRegistry: ToolRegistry;
  private sshPool: SSHConnectionPool;

  constructor(config: ServerConfig, configPath: string | null = null) {
    this.server = new Server({
      name: "windows-cli-server",
      version: packageJson.version,
    }, {
      capabilities: {
        tools: {},
        resources: {}
      }
    });

    // Initialize ServiceContainer
    this.container = new ServiceContainer();

    // Register services
    const configManager = new ConfigManager(config, configPath);

    // Prepare blocked commands set
    const blockedCommands = new Set(config.security.blockedCommands);

    const securityManager = new SecurityManager(config, blockedCommands, configPath);
    const historyManager = new HistoryManager(config.security.maxHistorySize, config.security.logCommands);
    const commandExecutor = new CommandExecutor(config, config.security.allowedPaths, configPath);
    const environmentManager = new EnvironmentManager(configManager);
    const jobManager = new JobManager(configManager);

    this.container.registerInstance('ConfigManager', configManager);
    this.container.registerInstance('SecurityManager', securityManager);
    this.container.registerInstance('HistoryManager', historyManager);
    this.container.registerInstance('CommandExecutor', commandExecutor);
    this.container.registerInstance('EnvironmentManager', environmentManager);
    this.container.registerInstance('JobManager', jobManager);

    // Initialize SSH pool
    this.sshPool = new SSHConnectionPool(config.ssh.strictHostKeyChecking);
    this.container.registerInstance('SSHConnectionPool', this.sshPool);

    // Initialize ToolRegistry and register all tools
    this.toolRegistry = new ToolRegistry();
    this.registerTools();

    this.setupHandlers();
  }

  private registerTools(): void {
    // Register command tools
    this.toolRegistry.register(new ExecuteCommandTool(this.container));
    this.toolRegistry.register(new ReadCommandHistoryTool(this.container));
    this.toolRegistry.register(new StartBackgroundJobTool(this.container));
    this.toolRegistry.register(new GetJobStatusTool(this.container));
    this.toolRegistry.register(new GetJobOutputTool(this.container));
    this.toolRegistry.register(new ExecuteBatchTool(this.container));

    // Register SSH tools
    this.toolRegistry.register(new SSHExecuteTool(this.container));
    this.toolRegistry.register(new SSHDisconnectTool(this.container));
    this.toolRegistry.register(new CreateSSHConnectionTool(this.container));
    this.toolRegistry.register(new ReadSSHConnectionsTool(this.container));
    this.toolRegistry.register(new UpdateSSHConnectionTool(this.container));
    this.toolRegistry.register(new DeleteSSHConnectionTool(this.container));
    this.toolRegistry.register(new ReadSSHPoolStatusTool(this.container));
    this.toolRegistry.register(new ValidateSSHConnectionTool(this.container));
    this.toolRegistry.register(new SFTPUploadTool(this.container));
    this.toolRegistry.register(new SFTPDownloadTool(this.container));
    this.toolRegistry.register(new SFTPListDirectoryTool(this.container));
    this.toolRegistry.register(new SFTPDeleteFileTool(this.container));

    // Register diagnostic tools
    this.toolRegistry.register(new CheckSecurityConfigTool(this.container));
    this.toolRegistry.register(new ValidateCommandTool(this.container));
    this.toolRegistry.register(new ExplainExitCodeTool(this.container));
    this.toolRegistry.register(new ValidateConfigTool(this.container));
    this.toolRegistry.register(new ReadSystemInfoTool(this.container));
    this.toolRegistry.register(new TestConnectionTool(this.container));
    this.toolRegistry.register(new ReadEnvironmentVariableTool(this.container));
    this.toolRegistry.register(new ListEnvironmentVariablesTool(this.container));
    this.toolRegistry.register(new GetConfigValueTool(this.container));
    this.toolRegistry.register(new ReloadConfigTool(this.container));
    this.toolRegistry.register(new DnsLookupTool(this.container));
    this.toolRegistry.register(new TestConnectivityTool(this.container));

    // Register system tools
    this.toolRegistry.register(new ReadCurrentDirectoryTool(this.container));
    this.toolRegistry.register(new GetCpuUsageTool(this.container));
    this.toolRegistry.register(new GetDiskSpaceTool(this.container));
    this.toolRegistry.register(new ListProcessesTool(this.container));
  }

  private setupHandlers(): void {
    const configManager = this.container.get<ConfigManager>('ConfigManager');
    const config = configManager.getConfig();

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const sshConnections = readSSHConnections() as Record<string, any>;

      const resources = Object.entries(sshConnections).map(([id, config]) => ({
        uri: `ssh://${id}`,
        name: `SSH Connection: ${id}`,
        description: `SSH connection to ${config.host}:${config.port} as ${config.username}`,
        mimeType: "application/json"
      }));

      resources.push({
        uri: "cli://currentdir",
        name: "Current Working Directory",
        description: "The current working directory of the CLI server",
        mimeType: "text/plain"
      });

      resources.push({
        uri: "ssh://config",
        name: "SSH Configuration",
        description: "All SSH connection configurations",
        mimeType: "application/json"
      });

      resources.push({
        uri: "cli://config",
        name: "CLI Server Configuration",
        description: "Main CLI server configuration (excluding sensitive data)",
        mimeType: "application/json"
      });

      resources.push({
        uri: "cli://validation-rules",
        name: "Security Validation Rules",
        description: "Complete security validation rules including blocked commands, arguments, operators, and path restrictions",
        mimeType: "application/json"
      });

      resources.push({
        uri: "cli://history-summary",
        name: "Command History Summary",
        description: "Summary of recent command executions with statistics and patterns",
        mimeType: "application/json"
      });

      resources.push({
        uri: "ssh://pool-status",
        name: "SSH Connection Pool Status",
        description: "Active SSH connections, pool statistics, and connection health",
        mimeType: "application/json"
      });

      resources.push({
        uri: "cli://background-jobs",
        name: "Background Jobs",
        description: "Status of all background command execution jobs",
        mimeType: "application/json"
      });

      return { resources };
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      if (uri.startsWith("ssh://") && uri !== "ssh://config") {
        const connectionId = uri.slice(6);
        const connections = readSSHConnections() as Record<string, any>;
        const connectionConfig = connections[connectionId];

        if (!connectionConfig) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown SSH connection: ${connectionId}`
          );
        }

        const safeConfig = { ...connectionConfig };
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

      if (uri === "ssh://config") {
        const connections = readSSHConnections() as Record<string, any>;
        const safeConnections = { ...connections };

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
              enabled: config.ssh.enabled,
              defaultTimeout: config.ssh.defaultTimeout,
              maxConcurrentSessions: config.ssh.maxConcurrentSessions,
              connections: safeConnections
            }, null, 2)
          }]
        };
      }

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

      if (uri === "cli://config") {
        const safeConfig = {
          security: {
            ...config.security,
          },
          shells: {
            ...config.shells
          },
          ssh: {
            enabled: config.ssh.enabled,
            defaultTimeout: config.ssh.defaultTimeout,
            maxConcurrentSessions: config.ssh.maxConcurrentSessions,
            connections: Object.keys(config.ssh.connections).length
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

      if (uri === "cli://validation-rules") {
        const securityManager = this.container.get<SecurityManager>('SecurityManager');
        const securityConfig = configManager.getSecurity();

        const validationRules = {
          blocked_commands: {
            description: "Commands that are blocked from execution (case-insensitive, checks all file extensions)",
            commands: securityConfig.blockedCommands,
            note: "Blocked commands are checked against basename with .exe, .cmd, .bat, .ps1, .vbs, etc."
          },
          blocked_arguments: {
            description: "Argument patterns that are blocked (regex-based, case-insensitive)",
            patterns: securityConfig.blockedArguments,
            note: "Each argument is checked independently against these patterns"
          },
          blocked_operators: {
            description: "Shell operators blocked per shell (including Unicode variants and zero-width characters)",
            powershell: config.shells.powershell.blockedOperators,
            cmd: config.shells.cmd.blockedOperators,
            gitbash: config.shells.gitbash.blockedOperators,
            note: "Includes detection of Unicode homoglyphs (｜, ； , ＆) and zero-width characters"
          },
          path_restrictions: {
            description: "Working directory restrictions",
            enabled: securityConfig.restrictWorkingDirectory,
            allowed_paths: securityConfig.allowedPaths,
            note: "Paths are canonicalized (symlinks resolved) before validation to prevent TOCTOU attacks"
          },
          length_limits: {
            description: "Command length restrictions",
            max_command_length: securityConfig.maxCommandLength,
            note: "Commands exceeding this length are rejected before execution"
          },
          timeout_settings: {
            description: "Command timeout settings",
            command_timeout_seconds: securityConfig.commandTimeout,
            note: "Commands are automatically terminated after this duration"
          },
          dangerous_characters: {
            description: "Characters that are always blocked",
            blocked: ["null bytes (\\0)", "control characters (except \\n, \\t)"],
            note: "These are blocked in addition to shell operators"
          },
          redirection_blocking: {
            description: "File redirection operators blocked",
            operators: [">", "<", ">>", "2>", "2>&1"],
            note: "Blocked in addition to shell operators for extra security"
          },
          validation_pipeline: {
            description: "Multi-stage validation order (fail-fast)",
            stages: [
              "1. Shell operator check (highest priority)",
              "2. Command parsing (handles quotes, escapes, detects unclosed quotes)",
              "3. Command blocking (basename case-insensitive with all extensions)",
              "4. Argument blocking (regex-based, case-insensitive)",
              "5. Length check (command must be ≤ maxCommandLength)",
              "6. Working directory validation (if restrictWorkingDirectory=true)"
            ]
          }
        };

        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(validationRules, null, 2)
          }]
        };
      }

      if (uri === "cli://history-summary") {
        const historyManager = this.container.get<HistoryManager>('HistoryManager');
        const history = historyManager.getAll();

        // Calculate statistics
        const totalCommands = history.length;
        const successfulCommands = history.filter((h: CommandHistoryEntry) => h.exitCode === 0).length;
        const failedCommands = history.filter((h: CommandHistoryEntry) => h.exitCode !== 0).length;
        const validationFailures = history.filter((h: CommandHistoryEntry) => h.exitCode === -2).length;
        const executionFailures = history.filter((h: CommandHistoryEntry) => h.exitCode === -1).length;

        // Get recent commands (last 10)
        const recentCommands = history.slice(-10).reverse().map((h: CommandHistoryEntry) => ({
          command: h.command,
          timestamp: h.timestamp,
          exitCode: h.exitCode,
          status: h.exitCode === 0 ? 'success' : h.exitCode === -2 ? 'validation_failure' : 'execution_failure'
        }));

        // Find most common commands
        const commandCounts: Record<string, number> = {};
        history.forEach((h: CommandHistoryEntry) => {
          const cmd = h.command.split(' ')[0]; // Get first word (command name)
          commandCounts[cmd] = (commandCounts[cmd] || 0) + 1;
        });
        const mostCommon = Object.entries(commandCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([cmd, count]) => ({ command: cmd, count }));

        // Find most common errors
        const errorCounts: Record<number, number> = {};
        history.filter((h: CommandHistoryEntry) => h.exitCode !== 0).forEach((h: CommandHistoryEntry) => {
          errorCounts[h.exitCode] = (errorCounts[h.exitCode] || 0) + 1;
        });
        const commonErrors = Object.entries(errorCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([code, count]) => ({ exitCode: parseInt(code), count }));

        const summary = {
          statistics: {
            total_commands: totalCommands,
            successful_commands: successfulCommands,
            failed_commands: failedCommands,
            validation_failures: validationFailures,
            execution_failures: executionFailures,
            success_rate: totalCommands > 0 ? ((successfulCommands / totalCommands) * 100).toFixed(1) + '%' : 'N/A'
          },
          recent_commands: recentCommands,
          most_common_commands: mostCommon,
          most_common_errors: commonErrors,
          history_enabled: historyManager.isEnabled(),
          max_history_size: 1000, // from config
          current_history_size: totalCommands
        };

        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(summary, null, 2)
          }]
        };
      }

      if (uri === "ssh://pool-status") {
        const sshPool = this.container.get<SSHConnectionPool>('SSHConnectionPool');
        const poolStats = sshPool.getPoolStats();

        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(poolStats, null, 2)
          }]
        };
      }

      if (uri === "cli://background-jobs") {
        const jobManager = this.container.get<JobManager>('JobManager');
        const jobs = jobManager.getAllJobs();

        const jobsData = jobs.map(job => ({
          jobId: job.id,
          shell: job.shell,
          command: job.command,
          status: job.status,
          pid: job.pid,
          startTime: new Date(job.startTime).toISOString(),
          endTime: job.endTime ? new Date(job.endTime).toISOString() : null,
          exitCode: job.exitCode ?? null,
          outputSize: job.output.length
        }));

        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              jobCount: jobs.length,
              runningJobs: jobs.filter(j => j.status === 'running').length,
              completedJobs: jobs.filter(j => j.status === 'completed').length,
              failedJobs: jobs.filter(j => j.status === 'failed').length,
              timedOutJobs: jobs.filter(j => j.status === 'timeout').length,
              jobs: jobsData
            }, null, 2)
          }]
        };
      }

      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unknown resource URI: ${uri}`
      );
    });

    // List available tools - delegate to ToolRegistry
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.toolRegistry.getToolDefinitions() };
    });

    // Execute tools - delegate to ToolRegistry
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const result = await this.toolRegistry.execute(request.params.name, request.params.arguments || {});
        return result;
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          error instanceof Error ? error.message : String(error)
        );
      }
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error("Windows CLI MCP Server running on stdio");
    console.error(`Version: ${packageJson.version}`);
  }

  async cleanup() {
    // Cleanup background jobs
    const jobManager = this.container.get<JobManager>('JobManager');
    if (jobManager) {
      jobManager.cleanup();
      jobManager.stopCleanup();
    }

    // Close SSH pool
    if (this.sshPool) {
      this.sshPool.closeAll();
    }
  }
}

// Main execution
(async () => {
  try {
    const args = await parseArgs();

    // Handle --init-config option
    if (args['init-config']) {
      const configPath = args['init-config'];
      await createDefaultConfig(configPath);
      console.error(`Default config file created at: ${configPath}`);
      console.error('Please review and customize the config, then restart the server with --config flag.');
      process.exit(0);
    }

    // Load config
    const configPathArg = args.config as string | undefined;
    const { config, configPath } = loadConfig(configPathArg);

    // Create and start server
    const server = new CLIServer(config, configPath);

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.error('\nShutting down server...');
      await server.cleanup();
      process.exit(0);
    });

    await server.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();
