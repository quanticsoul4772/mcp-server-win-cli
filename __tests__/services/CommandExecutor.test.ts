import { jest } from '@jest/globals';
import { CommandExecutor } from '../../src/services/CommandExecutor.js';
import type { ServerConfig } from '../../src/types/config.js';
import { spawn } from 'child_process';

// Mock child_process
jest.mock('child_process');

// Mock validation utilities
jest.mock('../../src/utils/validation.js', () => ({
  canonicalizePath: jest.fn((path: string) => path),
  isPathAllowed: jest.fn(() => true)
}));

// Mock error sanitizer
jest.mock('../../src/utils/errorSanitizer.js', () => ({
  sanitizePathError: jest.fn((path: string) => path),
  createUserFriendlyError: jest.fn((err: any) => err.message || String(err))
}));

describe('CommandExecutor', () => {
  let mockConfig: ServerConfig;
  let executor: CommandExecutor;
  let mockSpawn: jest.MockedFunction<typeof spawn>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      security: {
        blockedCommands: [],
        blockedArguments: [],
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

    executor = new CommandExecutor(mockConfig, mockConfig.security.allowedPaths, null);
    mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
  });

  describe('execute()', () => {
    it('should execute command successfully with exit code 0', async () => {
      const mockProcess = {
        stdout: {
          on: jest.fn((event: string, handler: any) => {
            if (event === 'data') {
              handler(Buffer.from('test output'));
            }
          })
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn((event: string, handler: any) => {
          if (event === 'close') {
            handler(0);
          }
        }),
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const result = await executor.execute({
        shell: 'powershell',
        command: 'Get-Process',
        workingDir: 'C:\\Users\\test'
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('test output');
      expect(result.error).toBe('');
      expect(mockSpawn).toHaveBeenCalledWith(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Get-Process'],
        expect.objectContaining({ cwd: 'C:\\Users\\test' })
      );
    });

    it('should capture stderr on command failure', async () => {
      const mockProcess = {
        stdout: {
          on: jest.fn()
        },
        stderr: {
          on: jest.fn((event: string, handler: any) => {
            if (event === 'data') {
              handler(Buffer.from('error message'));
            }
          })
        },
        on: jest.fn((event: string, handler: any) => {
          if (event === 'close') {
            handler(1);
          }
        }),
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const result = await executor.execute({
        shell: 'cmd',
        command: 'invalid-command'
      });

      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('error message');
    });

    it('should use default working directory when not specified', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, handler: any) => {
          if (event === 'close') handler(0);
        }),
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      await executor.execute({
        shell: 'powershell',
        command: 'pwd'
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'powershell.exe',
        expect.any(Array),
        expect.objectContaining({ cwd: expect.any(String) })
      );
    });

    it('should enforce timeout and kill process', async () => {
      jest.useFakeTimers();

      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const executePromise = executor.execute({
        shell: 'powershell',
        command: 'Start-Sleep -Seconds 60',
        timeout: 1
      });

      jest.advanceTimersByTime(1100);

      await expect(executePromise).rejects.toThrow(/timed out/i);
      expect(mockProcess.kill).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should use custom timeout when provided', async () => {
      jest.useFakeTimers();

      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const executePromise = executor.execute({
        shell: 'powershell',
        command: 'long-running-command',
        timeout: 60
      });

      // Should NOT timeout after default 30 seconds
      jest.advanceTimersByTime(35000);
      expect(mockProcess.kill).not.toHaveBeenCalled();

      // Should timeout after custom 60 seconds
      jest.advanceTimersByTime(30000);
      await expect(executePromise).rejects.toThrow(/timed out/i);

      jest.useRealTimers();
    });

    it('should handle process spawn errors', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('Failed to spawn process');
      });

      await expect(
        executor.execute({
          shell: 'powershell',
          command: 'test'
        })
      ).rejects.toThrow(/Failed to start shell process/i);
    });

    it('should handle missing stdout/stderr streams', async () => {
      const mockProcess = {
        stdout: null,
        stderr: null,
        on: jest.fn(),
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      await expect(
        executor.execute({
          shell: 'powershell',
          command: 'test'
        })
      ).rejects.toThrow(/Failed to initialize shell process streams/i);
    });

    it('should return exit code -1 when process exits without code', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, handler: any) => {
          if (event === 'close') {
            handler(null); // No exit code
          }
        }),
        kill: jest.fn()
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const result = await executor.execute({
        shell: 'powershell',
        command: 'test'
      });

      expect(result.exitCode).toBe(-1);
    });
  });

  describe('formatResult()', () => {
    it('should format successful result', () => {
      const result = {
        output: 'success output',
        error: '',
        exitCode: 0,
        workingDirectory: 'C:\\Users\\test'
      };

      const formatted = executor.formatResult(result, 'test-command');
      expect(formatted).toBe('success output');
    });

    it('should handle empty output on success', () => {
      const result = {
        output: '',
        error: '',
        exitCode: 0,
        workingDirectory: 'C:\\Users\\test'
      };

      const formatted = executor.formatResult(result, 'test-command');
      expect(formatted).toContain('completed successfully');
    });

    it('should format error result with both output and error', () => {
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

    it('should handle error with no output', () => {
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
  });
});
