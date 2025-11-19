import { ConfigManager } from '../../src/services/ConfigManager.js';
import type { ServerConfig } from '../../src/types/config.js';

describe('ConfigManager', () => {
  let mockConfig: ServerConfig;
  let configManager: ConfigManager;

  beforeEach(() => {
    mockConfig = {
      security: {
        blockedCommands: ['rm', 'del', 'format'],
        blockedArguments: ['--exec', '-e'],
        allowedPaths: ['C:\\Users\\test', 'C:\\Projects'],
        restrictWorkingDirectory: true,
        maxCommandLength: 2000,
        commandTimeout: 30,
        logCommands: true,
        maxHistorySize: 100
      },
      shells: {
        powershell: {
          enabled: true,
          command: 'powershell.exe',
          args: ['-NoProfile', '-Command'],
          blockedOperators: ['&', '|', ';', '`']
        },
        cmd: {
          enabled: true,
          command: 'cmd.exe',
          args: ['/c'],
          blockedOperators: ['&', '|']
        },
        gitbash: {
          enabled: false,
          command: 'C:\\Program Files\\Git\\bin\\bash.exe',
          args: ['-c'],
          blockedOperators: ['&', '|', ';', '`']
        }
      },
      ssh: {
        enabled: true,
        connections: {
          'test-server': {
            host: 'test.example.com',
            port: 22,
            username: 'testuser',
            password: 'testpass'
          }
        },
        defaultTimeout: 30,
        maxConcurrentSessions: 10,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
        readyTimeout: 20000,
        strictHostKeyChecking: true
      }
    };

    configManager = new ConfigManager(mockConfig, 'C:\\config\\config.json');
  });

  describe('getConfig()', () => {
    it('should return full server configuration', () => {
      const config = configManager.getConfig();
      expect(config).toEqual(mockConfig);
    });

    it('should return reference to actual config object', () => {
      const config = configManager.getConfig();
      expect(config).toBe(mockConfig);
    });
  });

  describe('getSecurity()', () => {
    it('should return security configuration section', () => {
      const security = configManager.getSecurity();

      expect(security).toEqual({
        blockedCommands: ['rm', 'del', 'format'],
        blockedArguments: ['--exec', '-e'],
        allowedPaths: ['C:\\Users\\test', 'C:\\Projects'],
        restrictWorkingDirectory: true,
        maxCommandLength: 2000,
        commandTimeout: 30,
        logCommands: true,
        maxHistorySize: 100
      });
    });
  });

  describe('getShells()', () => {
    it('should return all shell configurations', () => {
      const shells = configManager.getShells();

      expect(shells).toEqual(mockConfig.shells);
      expect(shells).toHaveProperty('powershell');
      expect(shells).toHaveProperty('cmd');
      expect(shells).toHaveProperty('gitbash');
    });
  });

  describe('getSSH()', () => {
    it('should return SSH configuration section', () => {
      const ssh = configManager.getSSH();

      expect(ssh).toEqual({
        enabled: true,
        connections: {
          'test-server': {
            host: 'test.example.com',
            port: 22,
            username: 'testuser',
            password: 'testpass'
          }
        },
        defaultTimeout: 30,
        maxConcurrentSessions: 10,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
        readyTimeout: 20000,
        strictHostKeyChecking: true
      });
    });
  });

  describe('getConfigPath()', () => {
    it('should return config file path when provided', () => {
      const path = configManager.getConfigPath();
      expect(path).toBe('C:\\config\\config.json');
    });

    it('should return null when no config path', () => {
      const managerWithoutPath = new ConfigManager(mockConfig, null);
      expect(managerWithoutPath.getConfigPath()).toBeNull();
    });
  });

  describe('getEnabledShells()', () => {
    it('should return array of enabled shell names', () => {
      const enabled = configManager.getEnabledShells();

      expect(enabled).toEqual(['powershell', 'cmd']);
      expect(enabled).toHaveLength(2);
    });

    it('should return empty array when no shells enabled', () => {
      const configWithNoShells = {
        ...mockConfig,
        shells: {
          powershell: { ...mockConfig.shells.powershell, enabled: false },
          cmd: { ...mockConfig.shells.cmd, enabled: false },
          gitbash: { ...mockConfig.shells.gitbash, enabled: false }
        }
      };

      const manager = new ConfigManager(configWithNoShells, null);
      expect(manager.getEnabledShells()).toEqual([]);
    });

    it('should return all shells when all enabled', () => {
      const configAllEnabled = {
        ...mockConfig,
        shells: {
          powershell: { ...mockConfig.shells.powershell, enabled: true },
          cmd: { ...mockConfig.shells.cmd, enabled: true },
          gitbash: { ...mockConfig.shells.gitbash, enabled: true }
        }
      };

      const manager = new ConfigManager(configAllEnabled, null);
      expect(manager.getEnabledShells()).toEqual(['powershell', 'cmd', 'gitbash']);
    });
  });

  describe('getAllowedPaths()', () => {
    it('should return array of allowed paths', () => {
      const paths = configManager.getAllowedPaths();

      expect(paths).toEqual(['C:\\Users\\test', 'C:\\Projects']);
      expect(paths).toHaveLength(2);
    });

    it('should return empty array when no allowed paths', () => {
      const configWithNoPaths = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          allowedPaths: []
        }
      };

      const manager = new ConfigManager(configWithNoPaths, null);
      expect(manager.getAllowedPaths()).toEqual([]);
    });
  });

  describe('getBlockedCommands()', () => {
    it('should return array of blocked command names', () => {
      const blocked = configManager.getBlockedCommands();

      expect(blocked).toEqual(['rm', 'del', 'format']);
      expect(blocked).toHaveLength(3);
    });

    it('should return empty array when no blocked commands', () => {
      const configWithNoBlocked = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          blockedCommands: []
        }
      };

      const manager = new ConfigManager(configWithNoBlocked, null);
      expect(manager.getBlockedCommands()).toEqual([]);
    });
  });

  describe('isShellEnabled()', () => {
    it('should return true for enabled shells', () => {
      expect(configManager.isShellEnabled('powershell')).toBe(true);
      expect(configManager.isShellEnabled('cmd')).toBe(true);
    });

    it('should return false for disabled shells', () => {
      expect(configManager.isShellEnabled('gitbash')).toBe(false);
    });

    it('should return false for non-existent shells', () => {
      expect(configManager.isShellEnabled('nonexistent')).toBe(false);
    });
  });

  describe('isHistoryLoggingEnabled()', () => {
    it('should return true when logging enabled', () => {
      expect(configManager.isHistoryLoggingEnabled()).toBe(true);
    });

    it('should return false when logging disabled', () => {
      const configWithNoLogging = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          logCommands: false
        }
      };

      const manager = new ConfigManager(configWithNoLogging, null);
      expect(manager.isHistoryLoggingEnabled()).toBe(false);
    });
  });

  describe('getCommandTimeout()', () => {
    it('should return command timeout value', () => {
      expect(configManager.getCommandTimeout()).toBe(30);
    });

    it('should return different timeout values', () => {
      const configWithCustomTimeout = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          commandTimeout: 60
        }
      };

      const manager = new ConfigManager(configWithCustomTimeout, null);
      expect(manager.getCommandTimeout()).toBe(60);
    });
  });

  describe('getMaxHistorySize()', () => {
    it('should return max history size', () => {
      expect(configManager.getMaxHistorySize()).toBe(100);
    });

    it('should return different history sizes', () => {
      const configWithLargeHistory = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          maxHistorySize: 500
        }
      };

      const manager = new ConfigManager(configWithLargeHistory, null);
      expect(manager.getMaxHistorySize()).toBe(500);
    });
  });

  describe('Config-time environment variable validation', () => {
    it('should throw if defaultEnv contains blocked env var', () => {
      const configWithBlockedDefaultEnv = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          blockedEnvVars: ['BLOCKED_VAR']
        },
        shells: {
          ...mockConfig.shells,
          powershell: {
            ...mockConfig.shells.powershell,
            defaultEnv: {
              BLOCKED_VAR: 'value'
            }
          }
        }
      };

      expect(() => {
        new ConfigManager(configWithBlockedDefaultEnv, null);
      }).toThrow(/contains blocked environment variable/i);
    });

    it('should throw if defaultEnv matches blocked pattern', () => {
      const configWithPatternMatch = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          blockedEnvVars: ['PASSWORD']
        },
        shells: {
          ...mockConfig.shells,
          powershell: {
            ...mockConfig.shells.powershell,
            defaultEnv: {
              MY_PASSWORD_VAR: 'secret'
            }
          }
        }
      };

      expect(() => {
        new ConfigManager(configWithPatternMatch, null);
      }).toThrow(/matches blocked pattern/i);
    });

    it('should throw if defaultEnv value exceeds max length', () => {
      const longValue = 'a'.repeat(40000);
      const configWithLongValue = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          maxEnvVarValueLength: 1000
        },
        shells: {
          ...mockConfig.shells,
          powershell: {
            ...mockConfig.shells.powershell,
            defaultEnv: {
              LONG_VAR: longValue
            }
          }
        }
      };

      expect(() => {
        new ConfigManager(configWithLongValue, null);
      }).toThrow(/exceeds maximum length/i);
    });

    it('should throw if defaultEnv value contains null bytes', () => {
      const configWithNullBytes = {
        ...mockConfig,
        shells: {
          ...mockConfig.shells,
          powershell: {
            ...mockConfig.shells.powershell,
            defaultEnv: {
              BAD_VAR: 'value\x00withnull'
            }
          }
        }
      };

      expect(() => {
        new ConfigManager(configWithNullBytes, null);
      }).toThrow(/null bytes/i);
    });

    it('should allow valid defaultEnv configuration', () => {
      const configWithValidDefaultEnv = {
        ...mockConfig,
        shells: {
          ...mockConfig.shells,
          powershell: {
            ...mockConfig.shells.powershell,
            defaultEnv: {
              PYTHONIOENCODING: 'utf-8',
              PYTHONUTF8: '1'
            }
          }
        }
      };

      expect(() => {
        new ConfigManager(configWithValidDefaultEnv, null);
      }).not.toThrow();
    });

    it('should use default blocked vars when not specified in config', () => {
      // PATH is in the default blocked list
      const configWithPathInDefaultEnv = {
        ...mockConfig,
        shells: {
          ...mockConfig.shells,
          powershell: {
            ...mockConfig.shells.powershell,
            defaultEnv: {
              PATH: '/custom/path'
            }
          }
        }
      };

      expect(() => {
        new ConfigManager(configWithPathInDefaultEnv, null);
      }).toThrow(/blocked/i);
    });

    it('should throw if defaultEnv value contains control characters', () => {
      const configWithControlChars = {
        ...mockConfig,
        shells: {
          ...mockConfig.shells,
          powershell: {
            ...mockConfig.shells.powershell,
            defaultEnv: {
              BAD_VAR: 'value\x01withcontrol'
            }
          }
        }
      };

      expect(() => {
        new ConfigManager(configWithControlChars, null);
      }).toThrow(/control characters/i);
    });
  });
});
