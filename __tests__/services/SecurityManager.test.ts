import { describe, test, expect, beforeEach } from '@jest/globals';
import { SecurityManager } from '../../src/services/SecurityManager.js';
import type { ServerConfig } from '../../src/types/config.js';

describe('SecurityManager', () => {
  let mockConfig: ServerConfig;
  let blockedCommands: Set<string>;
  let security: SecurityManager;

  beforeEach(() => {
    mockConfig = {
      security: {
        blockedCommands: ['rm', 'del', 'format'],
        blockedArguments: ['--exec', '-e'],
        allowedPaths: ['C:\\Users\\test'],
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
        enabled: false,
        connections: {},
        defaultTimeout: 30,
        maxConcurrentSessions: 10,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
        readyTimeout: 20000,
        strictHostKeyChecking: true
      }
    };

    blockedCommands = new Set(mockConfig.security.blockedCommands);
    security = new SecurityManager(mockConfig, blockedCommands, null);
  });

  describe('validateCommand()', () => {
    test('should throw on blocked command name', () => {
      expect(() => {
        security.validateCommand('powershell', 'rm -rf /');
      }).toThrow(/Command 'rm' is blocked/i);
    });

    test('should throw on command exceeding max length', () => {
      const longCommand = 'a'.repeat(2001);

      expect(() => {
        security.validateCommand('powershell', longCommand);
      }).toThrow(/exceeds maximum length of 2000/i);
    });

    test('should throw on shell operator in command', () => {
      expect(() => {
        security.validateCommand('powershell', 'cmd & calc');
      }).toThrow(/blocked operator/i);
    });

    test('should throw on pipe operator', () => {
      expect(() => {
        security.validateCommand('powershell', 'dir | findstr test');
      }).toThrow(/blocked operator/i);
    });

    test('should throw on semicolon operator', () => {
      expect(() => {
        security.validateCommand('powershell', 'dir ; calc');
      }).toThrow(/blocked operator/i);
    });

    test('should throw on backtick operator', () => {
      expect(() => {
        security.validateCommand('powershell', 'echo `calc`');
      }).toThrow(/blocked operator/i);
    });

    test('should throw on blocked argument pattern', () => {
      expect(() => {
        security.validateCommand('powershell', 'python --exec malicious');
      }).toThrow(/Argument contains blocked pattern/i);
    });

    test('should validate command with allowed path', () => {
      // This should not throw
      expect(() => {
        security.validateCommand('powershell', 'Get-Process');
      }).not.toThrow();
    });

    test('should work with CMD shell', () => {
      expect(() => {
        security.validateCommand('cmd', 'dir & calc');
      }).toThrow(/blocked operator/i);
    });
  });

  describe('getConfig()', () => {
    test('should return security configuration summary', () => {
      const config = security.getConfig();

      expect(config).toEqual({
        maxCommandLength: 2000,
        blockedCommands: ['rm', 'del', 'format'],
        blockedArguments: ['--exec', '-e'],
        allowedPaths: ['C:\\Users\\test'],
        restrictWorkingDirectory: true,
        commandTimeout: 30,
        shells: [
          {
            name: 'powershell',
            enabled: true,
            blockedOperators: ['&', '|', ';', '`']
          },
          {
            name: 'cmd',
            enabled: true,
            blockedOperators: ['&', '|']
          },
          {
            name: 'gitbash',
            enabled: false,
            blockedOperators: ['&', '|', ';', '`']
          }
        ]
      });
    });

    test('should handle empty blocked operators', () => {
      const configWithNoOperators = {
        ...mockConfig,
        shells: {
          powershell: {
            enabled: true,
            command: 'powershell.exe',
            args: ['-NoProfile', '-Command'],
            blockedOperators: undefined
          }
        }
      } as any;

      const securityWithNoOperators = new SecurityManager(
        configWithNoOperators,
        blockedCommands,
        null
      );

      const config = securityWithNoOperators.getConfig();
      expect(config.shells[0].blockedOperators).toEqual([]);
    });
  });

  describe('getShellConfig()', () => {
    test('should return specific shell configuration', () => {
      const shellConfig = security.getShellConfig('powershell');

      expect(shellConfig).toEqual({
        enabled: true,
        command: 'powershell.exe',
        args: ['-NoProfile', '-Command'],
        blockedOperators: ['&', '|', ';', '`']
      });
    });

    test('should return configuration for different shells', () => {
      const cmdConfig = security.getShellConfig('cmd');
      expect(cmdConfig.command).toBe('cmd.exe');

      const bashConfig = security.getShellConfig('gitbash');
      expect(bashConfig.enabled).toBe(false);
    });
  });

  describe('getEnabledShells()', () => {
    test('should return list of enabled shell names', () => {
      const enabled = security.getEnabledShells();

      expect(enabled).toEqual(['powershell', 'cmd']);
      expect(enabled).not.toContain('gitbash');
    });

    test('should return empty array when no shells enabled', () => {
      const configWithNoShells = {
        ...mockConfig,
        shells: {
          powershell: { ...mockConfig.shells.powershell, enabled: false },
          cmd: { ...mockConfig.shells.cmd, enabled: false },
          gitbash: { ...mockConfig.shells.gitbash, enabled: false }
        }
      };

      const securityNoShells = new SecurityManager(
        configWithNoShells,
        blockedCommands,
        null
      );

      expect(securityNoShells.getEnabledShells()).toEqual([]);
    });

    test('should return all shells when all enabled', () => {
      const configAllEnabled = {
        ...mockConfig,
        shells: {
          powershell: { ...mockConfig.shells.powershell, enabled: true },
          cmd: { ...mockConfig.shells.cmd, enabled: true },
          gitbash: { ...mockConfig.shells.gitbash, enabled: true }
        }
      };

      const securityAllEnabled = new SecurityManager(
        configAllEnabled,
        blockedCommands,
        null
      );

      expect(securityAllEnabled.getEnabledShells()).toEqual([
        'powershell',
        'cmd',
        'gitbash'
      ]);
    });
  });

  describe('validateCommand() with config path', () => {
    test('should pass config path through validation', () => {
      const securityWithPath = new SecurityManager(
        mockConfig,
        blockedCommands,
        'C:\\config\\config.json'
      );

      // Should not throw for valid command
      expect(() => {
        securityWithPath.validateCommand('powershell', 'Get-Process');
      }).not.toThrow();
    });
  });

  describe('validateCommand() edge cases', () => {
    test('should handle commands with multiple arguments', () => {
      expect(() => {
        security.validateCommand('powershell', 'Get-Process -Name explorer -Id 1234');
      }).not.toThrow();
    });

    test('should detect blocked commands in paths', () => {
      expect(() => {
        security.validateCommand('powershell', 'C:\\tools\\rm.exe -rf /');
      }).toThrow(/Command 'rm' is blocked/i);
    });

    test('should handle case-insensitive blocked commands', () => {
      expect(() => {
        security.validateCommand('powershell', 'RM -rf /');
      }).toThrow(/Command 'rm' is blocked/i);
    });
  });

  describe('validateEnvironmentVariables()', () => {
    test('should validate environment variables in command validation', () => {
      const envVars = {
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      };

      // Should not throw for valid env vars
      expect(() => {
        security.validateCommand('powershell', 'python script.py', envVars);
      }).not.toThrow();
    });

    test('should reject blocked environment variables', () => {
      const envVars = {
        AWS_SECRET_KEY: 'secret'
      };

      expect(() => {
        security.validateCommand('powershell', 'python script.py', envVars);
      }).toThrow(/Environment variable validation failed/i);
    });

    test('should reject environment variables with null bytes', () => {
      const envVars = {
        SAFE_VAR: 'value\x00with\x00nulls'
      };

      expect(() => {
        security.validateCommand('powershell', 'python script.py', envVars);
      }).toThrow(/null bytes/i);
    });

    test('should skip validation when no env vars provided', () => {
      // Should not throw when env vars are undefined
      expect(() => {
        security.validateCommand('powershell', 'Get-Process');
      }).not.toThrow();

      // Should not throw when env vars are empty object
      expect(() => {
        security.validateCommand('powershell', 'Get-Process', {});
      }).not.toThrow();
    });

    test('should validate standalone environment variables', () => {
      const envVars = {
        CUSTOM_VAR: 'value'
      };

      // Valid vars should not throw
      expect(() => {
        security.validateEnvironmentVariables(envVars);
      }).not.toThrow();
    });

    test('should reject blocked vars in standalone validation', () => {
      const envVars = {
        PASSWORD: 'secret'
      };

      expect(() => {
        security.validateEnvironmentVariables(envVars);
      }).toThrow(/blocked/i);
    });
  });

  describe('getConfig() with environment fields', () => {
    test('should include environment variable config fields', () => {
      const config = security.getConfig();

      // Should include the new environment fields
      expect(config).toHaveProperty('blockedEnvVars');
      expect(config).toHaveProperty('allowedEnvVars');
      expect(config).toHaveProperty('maxCustomEnvVars');
      expect(config).toHaveProperty('maxEnvVarValueLength');
    });

    test('should return undefined for unconfigured env fields', () => {
      const config = security.getConfig();

      // Default mock config doesn't have these set
      expect(config.blockedEnvVars).toBeUndefined();
      expect(config.allowedEnvVars).toBeUndefined();
    });

    test('should return configured env values when present', () => {
      const configWithEnvVars = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          blockedEnvVars: ['CUSTOM_BLOCKED'],
          allowedEnvVars: ['SAFE_VAR'],
          maxCustomEnvVars: 10,
          maxEnvVarValueLength: 1000
        }
      };

      const securityWithEnv = new SecurityManager(
        configWithEnvVars,
        blockedCommands,
        null
      );

      const config = securityWithEnv.getConfig();
      expect(config.blockedEnvVars).toEqual(['CUSTOM_BLOCKED']);
      expect(config.allowedEnvVars).toEqual(['SAFE_VAR']);
      expect(config.maxCustomEnvVars).toBe(10);
      expect(config.maxEnvVarValueLength).toBe(1000);
    });
  });
});
