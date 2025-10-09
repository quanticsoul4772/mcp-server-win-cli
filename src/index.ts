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
import type { ServerConfig } from './types/config.js';
import { SSHConnectionPool } from './utils/ssh.js';
import { createRequire } from 'module';
import { readSSHConnections } from './utils/sshManager.js';
import { ServiceContainer } from './server/ServiceContainer.js';
import { ToolRegistry } from './registries/ToolRegistry.js';
import { ConfigManager } from './services/ConfigManager.js';
import { SecurityManager } from './services/SecurityManager.js';
import { CommandExecutor } from './services/CommandExecutor.js';
import { HistoryManager } from './services/HistoryManager.js';
import { ExecuteCommandTool } from './tools/command/ExecuteCommandTool.js';
import { ReadCommandHistoryTool } from './tools/command/ReadCommandHistoryTool.js';
import { SSHExecuteTool } from './tools/ssh/SSHExecuteTool.js';
import { SSHDisconnectTool } from './tools/ssh/SSHDisconnectTool.js';
import { CreateSSHConnectionTool } from './tools/ssh/CreateSSHConnectionTool.js';
import { ReadSSHConnectionsTool } from './tools/ssh/ReadSSHConnectionsTool.js';
import { UpdateSSHConnectionTool } from './tools/ssh/UpdateSSHConnectionTool.js';
import { DeleteSSHConnectionTool } from './tools/ssh/DeleteSSHConnectionTool.js';
import { ReadSSHPoolStatusTool } from './tools/ssh/ReadSSHPoolStatusTool.js';
import { ValidateSSHConnectionTool } from './tools/ssh/ValidateSSHConnectionTool.js';
import { CheckSecurityConfigTool } from './tools/diagnostics/CheckSecurityConfigTool.js';
import { ValidateCommandTool } from './tools/diagnostics/ValidateCommandTool.js';
import { ReadCurrentDirectoryTool } from './tools/system/ReadCurrentDirectoryTool.js';
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

    this.container.registerInstance('ConfigManager', configManager);
    this.container.registerInstance('SecurityManager', securityManager);
    this.container.registerInstance('HistoryManager', historyManager);
    this.container.registerInstance('CommandExecutor', commandExecutor);

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

    // Register SSH tools
    this.toolRegistry.register(new SSHExecuteTool(this.container));
    this.toolRegistry.register(new SSHDisconnectTool(this.container));
    this.toolRegistry.register(new CreateSSHConnectionTool(this.container));
    this.toolRegistry.register(new ReadSSHConnectionsTool(this.container));
    this.toolRegistry.register(new UpdateSSHConnectionTool(this.container));
    this.toolRegistry.register(new DeleteSSHConnectionTool(this.container));
    this.toolRegistry.register(new ReadSSHPoolStatusTool(this.container));
    this.toolRegistry.register(new ValidateSSHConnectionTool(this.container));

    // Register diagnostic tools
    this.toolRegistry.register(new CheckSecurityConfigTool(this.container));
    this.toolRegistry.register(new ValidateCommandTool(this.container));

    // Register system tools
    this.toolRegistry.register(new ReadCurrentDirectoryTool(this.container));
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
