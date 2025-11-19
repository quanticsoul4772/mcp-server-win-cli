import fs from 'fs';
import path from 'path';
import lockfile from 'proper-lockfile';
import { ServerConfig, SSHConnectionConfig } from '../types/config.js';
import { loadConfig as loadMainConfig } from './config.js';
import { SSHConnectionConfigSchema } from '../types/schemas.js';
import { loggers } from '../services/Logger.js';

/**
 * Load the current configuration from the config file.
 */
const loadConfig = (): ServerConfig => {
  try {
    // Use the same config file that the main application uses
    const { config } = loadMainConfig();
    return config;
  } catch (error) {
    loggers.config.error('Error loading configuration', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
};

/**
 * Get the config file path from process arguments or default
 */
const getConfigPath = (): string => {
  const args = process.argv.slice(2);
  let configPath = './config.json';

  // Try to find a config path in the arguments
  for (let i = 0; i < args.length - 1; i++) {
    if ((args[i] === '--config' || args[i] === '-c') && args[i + 1]) {
      configPath = args[i + 1];
      break;
    }
  }

  return path.resolve(configPath);
};

/**
 * Save the updated configuration to the config file with file locking.
 * @param config The updated configuration object.
 */
const saveConfig = async (config: ServerConfig): Promise<void> => {
  const resolvedPath = getConfigPath();
  let release: (() => Promise<void>) | undefined;

  try {
    // Acquire exclusive lock with retry logic
    release = await lockfile.lock(resolvedPath, {
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000
      },
      stale: 5000 // Release stale locks after 5 seconds
    });

    // Write config atomically
    const tempPath = `${resolvedPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tempPath, resolvedPath);

  } catch (error) {
    loggers.config.error('Error saving configuration', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    // Always release the lock
    if (release) {
      try {
        await release();
      } catch (unlockError) {
        loggers.config.error('Error releasing config file lock', { error: unlockError instanceof Error ? unlockError.message : String(unlockError) });
      }
    }
  }
};

/**
 * Create a new SSH connection.
 * @param connectionId The ID for the new connection.
 * @param connectionConfig The configuration for the new connection.
 */
const createSSHConnection = async (connectionId: string, connectionConfig: SSHConnectionConfig): Promise<void> => {
  // Validate connection config at runtime
  const validatedConfig = SSHConnectionConfigSchema.parse(connectionConfig);

  const config = loadConfig();

  // Check if connection ID already exists
  if (config.ssh.connections[connectionId]) {
    throw new Error(`SSH connection with ID '${connectionId}' already exists`);
  }

  config.ssh.connections[connectionId] = validatedConfig;
  await saveConfig(config);
};

/**
 * Read all SSH connections.
 * @returns An object containing all SSH connections.
 */
const readSSHConnections = (): Record<string, SSHConnectionConfig> => {
  const config = loadConfig();
  return config.ssh.connections;
};

/**
 * Update an existing SSH connection.
 * @param connectionId The ID of the connection to update.
 * @param connectionConfig The new configuration for the connection.
 */
const updateSSHConnection = async (connectionId: string, connectionConfig: SSHConnectionConfig): Promise<void> => {
  // Validate connection config at runtime
  const validatedConfig = SSHConnectionConfigSchema.parse(connectionConfig);

  const config = loadConfig();

  if (!config.ssh.connections[connectionId]) {
    throw new Error(`SSH connection with ID '${connectionId}' does not exist`);
  }

  config.ssh.connections[connectionId] = validatedConfig;
  await saveConfig(config);
};

/**
 * Delete an SSH connection.
 * @param connectionId The ID of the connection to delete.
 */
const deleteSSHConnection = async (connectionId: string): Promise<void> => {
  const config = loadConfig();

  if (!config.ssh.connections[connectionId]) {
    throw new Error(`SSH connection with ID '${connectionId}' does not exist`);
  }

  delete config.ssh.connections[connectionId];
  await saveConfig(config);
};

export { createSSHConnection, readSSHConnections, updateSSHConnection, deleteSSHConnection }; 