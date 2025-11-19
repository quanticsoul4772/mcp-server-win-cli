import fs from 'fs';
import path from 'path';
import os from 'os';
import { ServerConfig, ShellConfig } from '../types/config.js';
import { secureDeepMerge } from './deepMerge.js';
import { ServerConfigSchema } from '../types/schemas.js';
import { loggers } from '../services/Logger.js';

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
    strictHostKeyChecking: true,
    connections: {}
  }
};

export function loadConfig(configPath?: string): { config: ServerConfig; configPath: string | null } {
  // If no config path provided, look in default locations
  const configLocations = [
    configPath,
    path.join(process.cwd(), 'config.json'),
    path.join(os.homedir(), '.win-cli-mcp', 'config.json')
  ].filter(Boolean);

  let loadedConfig: Partial<ServerConfig> = {};
  let actualConfigPath: string | null = null;

  for (const location of configLocations) {
    if (!location) continue;
    
    try {
      if (fs.existsSync(location)) {
        const fileContent = fs.readFileSync(location, 'utf8');
        loadedConfig = JSON.parse(fileContent);
        actualConfigPath = location;
        loggers.config.info('Loaded config', { path: location });
        break;
      }
    } catch (error) {
      loggers.config.warn('Error loading config', { path: location, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Use defaults only if no config was loaded
  const mergedConfig = Object.keys(loadedConfig).length > 0 
    ? mergeConfigs(DEFAULT_CONFIG, loadedConfig)
    : DEFAULT_CONFIG;

  // Validate the merged config
  validateConfig(mergedConfig);

  return { config: mergedConfig, configPath: actualConfigPath };
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

  // Validate allowedPaths after merge - warn if intersection resulted in empty array
  const userProvidedPaths = userConfig.security?.allowedPaths;
  if (userProvidedPaths && userProvidedPaths.length > 0) {
    if (merged.security.allowedPaths.length === 0) {
      // Empty allowedPaths after intersection - user will be locked out
      loggers.config.error('Config merge resulted in ZERO allowed paths!', {
        userPaths: userProvidedPaths,
        defaultPaths: defaultConfig.security.allowedPaths,
        mergedResult: [],
        explanation: 'Secure merge uses INTERSECTION for allowedPaths - paths must exist in BOTH configs',
        solutions: [
          `Use absolute paths that overlap with defaults: cwd=${process.cwd()}, home=${os.homedir()}`,
          'Disable path restrictions: set "restrictWorkingDirectory": false (NOT recommended)',
          'Include default paths in your allowedPaths array'
        ]
      });
    } else if (merged.security.allowedPaths.length < userProvidedPaths.length) {
      // Some paths were filtered out - inform user
      const defaultSet = new Set(defaultConfig.security.allowedPaths.map(p => p.toLowerCase()));
      const filtered = userProvidedPaths.filter(p => !defaultSet.has(p.toLowerCase()));
      loggers.config.info('Some allowedPaths were filtered during secure merge', {
        filteredPaths: filtered,
        allowedPaths: merged.security.allowedPaths
      });
    }
  }

  // Allow user to explicitly disable argument blocking with empty array
  if (userConfig.security?.blockedArguments !== undefined) {
    merged.security.blockedArguments = userConfig.security.blockedArguments;
  }

  // Ensure validatePath functions are preserved (they're functions, not serialized)
  for (const [key, shell] of Object.entries(merged.shells) as [keyof typeof merged.shells, ShellConfig][]) {
    if (!shell.validatePath) {
      shell.validatePath = defaultConfig.shells[key].validatePath;
    }
    // Allow user to explicitly disable operator blocking with empty array
    // If user config has blockedOperators defined (even as []), use it as-is
    // Only merge if user config doesn't specify blockedOperators
    if (userConfig.shells?.[key]?.blockedOperators !== undefined) {
      // User explicitly set blockedOperators - use their value
      shell.blockedOperators = userConfig.shells[key].blockedOperators || [];
    } else if (!shell.blockedOperators) {
      // User didn't specify - use defaults
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
