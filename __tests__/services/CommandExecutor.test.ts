import { describe, test, expect, beforeEach } from '@jest/globals';
import { CommandExecutor } from '../../src/services/CommandExecutor.js';
import type { ServerConfig } from '../../src/types/config.js';

describe('CommandExecutor', () => {
  let mockConfig: ServerConfig;
  let executor: CommandExecutor;

  beforeEach(() => {
    mockConfig = {
      security: {
        blockedCommands: [],
        blockedArguments: [],
        allowedPaths: [process.cwd()],
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

    executor = new CommandExecutor(mockConfig, mockConfig.security.allowedPaths, null);
  });

  describe('execute()', () => {
    test('should execute simple PowerShell command successfully', async () => {
      const result = await executor.execute({
        shell: 'powershell',
        command: 'Write-Output "test"'
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('test');
      expect(result.workingDirectory).toBeTruthy();
    }, 10000);

    test('should execute simple CMD command successfully', async () => {
      const result = await executor.execute({
        shell: 'cmd',
        command: 'echo test'
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('test');
    }, 10000);

    test('should capture exit code on command failure', async () => {
      const result = await executor.execute({
        shell: 'cmd',
        command: 'exit 1'
      });

      expect(result.exitCode).toBe(1);
    }, 10000);

    test('should use specified working directory', async () => {
      const result = await executor.execute({
        shell: 'powershell',
        command: 'Get-Location',
        workingDir: process.cwd()
      });

      expect(result.exitCode).toBe(0);
      expect(result.workingDirectory).toBe(process.cwd());
    }, 10000);

    test('should enforce timeout on long-running command', async () => {
      await expect(
        executor.execute({
          shell: 'powershell',
          command: 'Start-Sleep -Seconds 5',
          timeout: 1
        })
      ).rejects.toThrow(/timed out/i);
    }, 15000);

    test('should handle command that produces stderr', async () => {
      const result = await executor.execute({
        shell: 'powershell',
        command: 'Write-Error "test error"'
      });

      // PowerShell Write-Error writes to stderr but may exit 0
      expect(result.error).toContain('test error');
    }, 10000);

    test('should reject invalid working directory', async () => {
      await expect(
        executor.execute({
          shell: 'powershell',
          command: 'Get-Location',
          workingDir: 'C:\\nonexistent\\directory'
        })
      ).rejects.toThrow();
    }, 10000);

    test('should reject working directory outside allowed paths when restricted', async () => {
      const restrictedExecutor = new CommandExecutor(
        {
          ...mockConfig,
          security: {
            ...mockConfig.security,
            restrictWorkingDirectory: true,
            allowedPaths: ['C:\\AllowedPath']
          }
        },
        ['C:\\AllowedPath'],
        null
      );

      await expect(
        restrictedExecutor.execute({
          shell: 'powershell',
          command: 'Get-Location',
          workingDir: process.cwd() // Not in allowed paths
        })
      ).rejects.toThrow(/not in allowed paths/i);
    }, 10000);

    test('should allow working directory when restriction disabled', async () => {
      const unrestrictedExecutor = new CommandExecutor(
        {
          ...mockConfig,
          security: {
            ...mockConfig.security,
            restrictWorkingDirectory: false,
            allowedPaths: ['C:\\AllowedPath']
          }
        },
        ['C:\\AllowedPath'],
        null
      );

      const result = await unrestrictedExecutor.execute({
        shell: 'powershell',
        command: 'Get-Location',
        workingDir: process.cwd()
      });

      expect(result.exitCode).toBe(0);
    }, 10000);
  });

  describe('formatResult()', () => {
    test('should format successful result', () => {
      const result = {
        output: 'success output',
        error: '',
        exitCode: 0,
        workingDirectory: 'C:\\Users\\test'
      };

      const formatted = executor.formatResult(result, 'test-command');
      expect(formatted).toBe('success output');
    });

    test('should handle empty output on success', () => {
      const result = {
        output: '',
        error: '',
        exitCode: 0,
        workingDirectory: 'C:\\Users\\test'
      };

      const formatted = executor.formatResult(result, 'test-command');
      expect(formatted).toContain('completed successfully');
    });

    test('should format error result with both output and error', () => {
      const result = {
        output: 'stdout content',
        error: 'stderr content',
        exitCode: 1,
        workingDirectory: 'C:\\Users\\test'
      };

      const formatted = executor.formatResult(result, 'test-command');
      expect(formatted).toContain('exit code 1');
      expect(formatted).toContain('stderr content');
      expect(formatted).toContain('stdout content');
    });

    test('should handle error with no output', () => {
      const result = {
        output: '',
        error: '',
        exitCode: 1,
        workingDirectory: 'C:\\Users\\test'
      };

      const formatted = executor.formatResult(result, 'test-command');
      expect(formatted).toContain('exit code 1');
      expect(formatted).toContain('No error message or output');
    });

    test('should format error with only stderr', () => {
      const result = {
        output: '',
        error: 'error message only',
        exitCode: 2,
        workingDirectory: 'C:\\Users\\test'
      };

      const formatted = executor.formatResult(result, 'test-command');
      expect(formatted).toContain('exit code 2');
      expect(formatted).toContain('error message only');
    });

    test('should format error with only stdout', () => {
      const result = {
        output: 'output message only',
        error: '',
        exitCode: 3,
        workingDirectory: 'C:\\Users\\test'
      };

      const formatted = executor.formatResult(result, 'test-command');
      expect(formatted).toContain('exit code 3');
      expect(formatted).toContain('output message only');
    });
  });

  describe('integration tests', () => {
    test('should handle PowerShell with multiple output lines', async () => {
      const result = await executor.execute({
        shell: 'powershell',
        command: 'Write-Output "line1"; Write-Output "line2"'
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('line1');
      expect(result.output).toContain('line2');
    }, 10000);

    test('should handle CMD with echo off', async () => {
      const result = await executor.execute({
        shell: 'cmd',
        command: '@echo off & echo test'
      });

      expect(result.output).toContain('test');
    }, 10000);

    test('should handle commands with special characters in output', async () => {
      const result = await executor.execute({
        shell: 'powershell',
        command: 'Write-Output "test with $special #chars @here"'
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('test with');
    }, 10000);
  });
});
