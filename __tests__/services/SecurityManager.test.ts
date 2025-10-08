import { jest } from '@jest/globals';
import { SecurityManager } from '../../src/services/SecurityManager.js';
import type { ServerConfig } from '../../src/types/config.js';

// Import validation functions to mock them
import {
  validateShellOperators,
  parseCommand,
  extractCommandName,
  isCommandBlocked,
  getBlockedCommandName,
  isArgumentBlocked,
  getBlockedArgument
} from '../../src/utils/validation.js';

// Mock all validation utilities
jest.mock('../../src/utils/validation.js');

const mockValidateShellOperators = validateShellOperators as jest.MockedFunction<typeof validateShellOperators>;
const mockParseCommand = parseCommand as jest.MockedFunction<typeof parseCommand>;
const mockExtractCommandName = extractCommandName as jest.MockedFunction<typeof extractCommandName>;
const mockIsCommandBlocked = isCommandBlocked as jest.MockedFunction<typeof isCommandBlocked>;
const mockGetBlockedCommandName = getBlockedCommandName as jest.MockedFunction<typeof getBlockedCommandName>;
const mockIsArgumentBlocked = isArgumentBlocked as jest.MockedFunction<typeof isArgumentBlocked>;
const mockGetBlockedArgument = getBlockedArgument as jest.MockedFunction<typeof getBlockedArgument>;

describe('SecurityManager', () => {
  let mockConfig: ServerConfig;
  let blockedCommands: Set<string>;
  let security: SecurityManager;

  beforeEach(() => {
    jest.clearAllMocks();

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

    // Setup default mock implementations
    mockValidateShellOperators.mockImplementation(() => {});
    mockParseCommand.mockReturnValue({
      command: 'test-command',
      args: []
    });
    mockExtractCommandName.mockReturnValue('test-command');
    mockIsCommandBlocked.mockReturnValue(false);
    mockIsArgumentBlocked.mockReturnValue(false);
  });

  describe('validateCommand()', () => {
    it('should pass validation for safe command', () => {
      expect(() => {
        security.validateCommand('powershell', 'Get-Process');
      }).not.toThrow();

      expect(mockValidateShellOperators).toHaveBeenCalledWith(
        'Get-Process',
        mockConfig.shells.powershell,
        null
      );
      expect(mockParseCommand).toHaveBeenCalledWith('Get-Process');
    });

    it('should throw on blocked shell operators', () => {
      mockValidateShellOperators.mockImplementation(() => {
        throw new Error('Command contains blocked operator: &');
      });

      expect(() => {
        security.validateCommand('powershell', 'cmd & calc');
      }).toThrow(/blocked operator/i);
    });

    it('should throw on blocked command name', () => {
      mockExtractCommandName.mockReturnValue('rm');
      mockIsCommandBlocked.mockReturnValue(true);
      mockGetBlockedCommandName.mockReturnValue('rm');

      expect(() => {
        security.validateCommand('powershell', 'rm -rf /');
      }).toThrow(/Command 'rm' is blocked/i);

      expect(mockIsCommandBlocked).toHaveBeenCalledWith(
        'rm',
        ['rm', 'del', 'format']
      );
    });

    it('should throw on blocked arguments', () => {
      mockParseCommand.mockReturnValue({
        command: 'python',
        args: ['script.py', '--exec', 'malicious']
      });
      mockIsArgumentBlocked.mockReturnValue(true);
      mockGetBlockedArgument.mockReturnValue('--exec');

      expect(() => {
        security.validateCommand('powershell', 'python script.py --exec malicious');
      }).toThrow(/Argument contains blocked pattern '--exec'/i);

      expect(mockIsArgumentBlocked).toHaveBeenCalledWith(
        ['script.py', '--exec', 'malicious'],
        mockConfig.security.blockedArguments
      );
    });

    it('should throw on command exceeding max length', () => {
      const longCommand = 'a'.repeat(2001);

      expect(() => {
        security.validateCommand('powershell', longCommand);
      }).toThrow(/exceeds maximum length of 2000/i);
    });

    it('should validate all stages in order', () => {
      const command = 'Get-Process';

      security.validateCommand('powershell', command);

      // Verify call order
      expect(mockValidateShellOperators).toHaveBeenCalled();
      expect(mockParseCommand).toHaveBeenCalled();
      expect(mockExtractCommandName).toHaveBeenCalled();
      expect(mockIsCommandBlocked).toHaveBeenCalled();
      expect(mockIsArgumentBlocked).toHaveBeenCalled();
    });

    it('should stop validation on first failure', () => {
      mockValidateShellOperators.mockImplementation(() => {
        throw new Error('Operator blocked');
      });

      expect(() => {
        security.validateCommand('powershell', 'cmd & calc');
      }).toThrow('Operator blocked');

      // Later stages should not be called
      expect(mockParseCommand).not.toHaveBeenCalled();
    });

    it('should work with different shells', () => {
      security.validateCommand('cmd', 'dir');

      expect(mockValidateShellOperators).toHaveBeenCalledWith(
        'dir',
        mockConfig.shells.cmd,
        null
      );
    });

    it('should pass config path to validation', () => {
      const securityWithPath = new SecurityManager(
        mockConfig,
        blockedCommands,
        'C:\\config\\config.json'
      );

      securityWithPath.validateCommand('powershell', 'test');

      expect(mockValidateShellOperators).toHaveBeenCalledWith(
        'test',
        mockConfig.shells.powershell,
        'C:\\config\\config.json'
      );
    });
  });

  describe('getConfig()', () => {
    it('should return security configuration summary', () => {
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

    it('should handle empty blocked operators', () => {
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
    it('should return specific shell configuration', () => {
      const shellConfig = security.getShellConfig('powershell');

      expect(shellConfig).toEqual({
        enabled: true,
        command: 'powershell.exe',
        args: ['-NoProfile', '-Command'],
        blockedOperators: ['&', '|', ';', '`']
      });
    });

    it('should return configuration for different shells', () => {
      const cmdConfig = security.getShellConfig('cmd');
      expect(cmdConfig.command).toBe('cmd.exe');

      const bashConfig = security.getShellConfig('gitbash');
      expect(bashConfig.enabled).toBe(false);
    });
  });

  describe('getEnabledShells()', () => {
    it('should return list of enabled shell names', () => {
      const enabled = security.getEnabledShells();

      expect(enabled).toEqual(['powershell', 'cmd']);
      expect(enabled).not.toContain('gitbash');
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

      const securityNoShells = new SecurityManager(
        configWithNoShells,
        blockedCommands,
        null
      );

      expect(securityNoShells.getEnabledShells()).toEqual([]);
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
});
