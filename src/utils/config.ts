import fs from 'fs';
import path from 'path';
import os from 'os';
import { ServerConfig, ShellConfig } from '../types/config.js';
import { secureDeepMerge } from './deepMerge.js';
import { ServerConfigSchema } from '../types/schemas.js';

const defaultValidatePathRegex = /^[a-zA-Z]:\\(?:[^<>:"/\\|?*]+\\)*[^<>:"/\\|?*]*$/;

export const DEFAULT_CONFIG: ServerConfig = {
  security: {
    maxCommandLength: 2000,
    blockedCommands: [
      'rm', 'del', 'rmdir', 'format',
      'shutdown', 'restart',
      'reg', 'regedit',
      'net', 'netsh',
      'takeown', 'icacls'
    ],
    blockedArguments: [
      "--exec", "-e", "/c", "-enc", "-encodedcommand",
      "-command", "--interactive", "-i", "--login", "--system"
    ],
    allowedPaths: [
      os.homedir(),
      process.cwd()
    ],
    restrictWorkingDirectory: true,
    logCommands: true,
    maxHistorySize: 1000,
    commandTimeout: 30
  },
  shells: {
    powershell: {
      enabled: true,
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command'],
      validatePath: (dir: string) => dir.match(defaultValidatePathRegex) !== null,
      blockedOperators: ['&', '|', ';', '`']
    },
    cmd: {
      enabled: true,
      command: 'cmd.exe',
      args: ['/c'],
      validatePath: (dir: string) => dir.match(defaultValidatePathRegex) !== null,
      blockedOperators: ['&', '|', ';', '`']
    },
    gitbash: {
      enabled: true,
      command: 'C:\\Program Files\\Git\\bin\\bash.exe',
      args: ['-c'],
      validatePath: (dir: string) => dir.match(defaultValidatePathRegex) !== null,
      blockedOperators: ['&', '|', ';', '`']
    }
  },
  ssh: {
    enabled: false,
    defaultTimeout: 30,
    maxConcurrentSessions: 5,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    readyTimeout: 20000,
    connections: {}
  }
};

export function loadConfig(configPath?: string): ServerConfig {
  // If no config path provided, look in default locations
  const configLocations = [
    configPath,
    path.join(process.cwd(), 'config.json'),
    path.join(os.homedir(), '.win-cli-mcp', 'config.json')
  ].filter(Boolean);

  let loadedConfig: Partial<ServerConfig> = {};

  for (const location of configLocations) {
    if (!location) continue;
    
    try {
      if (fs.existsSync(location)) {
        const fileContent = fs.readFileSync(location, 'utf8');
        loadedConfig = JSON.parse(fileContent);
        console.error(`Loaded config from ${location}`);
        break;
      }
    } catch (error) {
      console.error(`Error loading config from ${location}:`, error);
    }
  }

  // Use defaults only if no config was loaded
  const mergedConfig = Object.keys(loadedConfig).length > 0 
    ? mergeConfigs(DEFAULT_CONFIG, loadedConfig)
    : DEFAULT_CONFIG;

  // Validate the merged config
  validateConfig(mergedConfig);

  return mergedConfig;
}

function mergeConfigs(defaultConfig: ServerConfig, userConfig: Partial<ServerConfig>): ServerConfig {
  // Define security-critical keys that should use most restrictive values
  const securityCriticalKeys = [
    'security.maxCommandLength',
    'security.restrictWorkingDirectory',
    'security.logCommands',
    'security.maxHistorySize',
    'security.commandTimeout'
  ];

  // Define restrictive array keys (use intersection to prevent weakening)
  const restrictiveArrayKeys = [
    'security.allowedPaths'
  ];

  // Perform secure deep merge
  const merged = secureDeepMerge(defaultConfig, userConfig, securityCriticalKeys, restrictiveArrayKeys);

  // Ensure validatePath functions are preserved (they're functions, not serialized)
  for (const [key, shell] of Object.entries(merged.shells) as [keyof typeof merged.shells, ShellConfig][]) {
    if (!shell.validatePath) {
      shell.validatePath = defaultConfig.shells[key].validatePath;
    }
    // Ensure blocked operators are merged (union of both lists)
    if (shell.blockedOperators && defaultConfig.shells[key].blockedOperators) {
      shell.blockedOperators = [...new Set([
        ...defaultConfig.shells[key].blockedOperators!,
        ...shell.blockedOperators
      ])];
    } else if (!shell.blockedOperators) {
      shell.blockedOperators = defaultConfig.shells[key].blockedOperators;
    }
  }

  return merged;
}

function validateConfig(config: ServerConfig): void {
  try {
    // Use Zod schema for comprehensive runtime validation
    ServerConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Configuration validation failed: ${error.message}`);
    }
    throw error;
  }

  // Additional custom validations not covered by Zod
  // Validate shell configurations
  for (const [shellName, shell] of Object.entries(config.shells)) {
    if (shell.enabled && (!shell.command || !shell.args)) {
      throw new Error(`Invalid configuration for ${shellName}: missing command or args`);
    }
  }
}

// Helper function to create a default config file
export function createDefaultConfig(configPath: string): void {
  const dirPath = path.dirname(configPath);
  
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  // Create a JSON-safe version of the config (excluding functions)
  const configForSave = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  fs.writeFileSync(configPath, JSON.stringify(configForSave, null, 2));
}