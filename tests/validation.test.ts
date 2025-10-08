import { describe, expect, test, jest } from '@jest/globals';
import path from 'path';
import {
  extractCommandName,
  isCommandBlocked,
  isArgumentBlocked,
  parseCommand,
  isPathAllowed,
  validateWorkingDirectory,
  normalizeWindowsPath,
  validateShellOperators,
  containsDangerousCharacters,
  canonicalizePath
} from '../src/utils/validation.js';
import type { ShellConfig } from '../src/types/config.js';

// Mock child_process exec
jest.mock('child_process', () => ({
  exec: jest.fn()
}));


describe('Command Name Extraction', () => {
  test('extractCommandName handles various formats', () => {
    expect(extractCommandName('cmd.exe')).toBe('cmd');
    expect(extractCommandName('C:\\Windows\\System32\\cmd.exe')).toBe('cmd');
    expect(extractCommandName('powershell.exe')).toBe('powershell');
    expect(extractCommandName('git.cmd')).toBe('git');
    expect(extractCommandName('program')).toBe('program');
    expect(extractCommandName('path/to/script.bat')).toBe('script');
  });

  test('extractCommandName is case insensitive', () => {
    expect(extractCommandName('CMD.EXE')).toBe('cmd');
    expect(extractCommandName('PowerShell.Exe')).toBe('powershell');
  });
});

describe('Command Blocking', () => {
  const blockedCommands = ['rm', 'del', 'format'];

  test('isCommandBlocked identifies blocked commands', () => {
    expect(isCommandBlocked('rm', blockedCommands)).toBe(true);
    expect(isCommandBlocked('rm.exe', blockedCommands)).toBe(true);
    expect(isCommandBlocked('C:\\Windows\\System32\\rm.exe', blockedCommands)).toBe(true);
    expect(isCommandBlocked('notepad.exe', blockedCommands)).toBe(false);
  });

  test('isCommandBlocked is case insensitive', () => {
    expect(isCommandBlocked('RM.exe', blockedCommands)).toBe(true);
    expect(isCommandBlocked('DeL.exe', blockedCommands)).toBe(true);
    expect(isCommandBlocked('FORMAT.EXE', blockedCommands)).toBe(true);
  });

  test('isCommandBlocked handles different extensions', () => {
    expect(isCommandBlocked('rm.cmd', blockedCommands)).toBe(true);
    expect(isCommandBlocked('del.bat', blockedCommands)).toBe(true);
    expect(isCommandBlocked('format.com', blockedCommands)).toBe(false); // Should only match .exe, .cmd, .bat
  });
});

describe('Argument Blocking', () => {
  const blockedArgs = ['--system', '-rf', '--exec'];

  test('isArgumentBlocked identifies blocked arguments', () => {
    expect(isArgumentBlocked(['--help', '--system'], blockedArgs)).toBe(true);
    expect(isArgumentBlocked(['-rf'], blockedArgs)).toBe(true);
    expect(isArgumentBlocked(['--safe', '--normal'], blockedArgs)).toBe(false);
  });

  test('isArgumentBlocked is case insensitive for security', () => {
    expect(isArgumentBlocked(['--SYSTEM'], blockedArgs)).toBe(true);
    expect(isArgumentBlocked(['-RF'], blockedArgs)).toBe(true);
    expect(isArgumentBlocked(['--SyStEm'], blockedArgs)).toBe(true);
  });

  test('isArgumentBlocked handles multiple arguments', () => {
    expect(isArgumentBlocked(['--safe', '--exec', '--other'], blockedArgs)).toBe(true);
    expect(isArgumentBlocked(['arg1', 'arg2', '--help'], blockedArgs)).toBe(false);
  });
});

describe('Command Parsing', () => {
  test('parseCommand handles basic commands', () => {
    expect(parseCommand('dir')).toEqual({ command: 'dir', args: [] });
    expect(parseCommand('echo hello')).toEqual({ command: 'echo', args: ['hello'] });
  });

  test('parseCommand handles quoted arguments', () => {
    expect(parseCommand('echo "hello world"')).toEqual({ 
      command: 'echo', 
      args: ['hello world']
    });
    expect(parseCommand('echo "first" "second"')).toEqual({
      command: 'echo',
      args: ['first', 'second']
    });
  });

  test('parseCommand handles paths with spaces', () => {
    expect(parseCommand('C:\\Program Files\\Git\\bin\\git.exe status')).toEqual({
      command: 'C:\\Program Files\\Git\\bin\\git.exe',
      args: ['status']
    });
  });

  test('parseCommand handles empty input', () => {
    expect(parseCommand('')).toEqual({ command: '', args: [] });
    expect(parseCommand('  ')).toEqual({ command: '', args: [] });
  });

  test('parseCommand handles mixed quotes', () => {
    expect(parseCommand('git commit -m "first commit" --author="John Doe"')).toEqual({
      command: 'git',
      args: ['commit', '-m', 'first commit', '--author=John Doe']
    });
  });
});

describe('Path Validation', () => {
  const allowedPaths = [
    'C:\\Users\\test',
    'D:\\Projects'
  ];

  test('isPathAllowed validates paths correctly', () => {
    expect(isPathAllowed('C:\\Users\\test\\docs', allowedPaths)).toBe(true);
    expect(isPathAllowed('C:\\Users\\test', allowedPaths)).toBe(true);
    expect(isPathAllowed('D:\\Projects\\code', allowedPaths)).toBe(true);
    expect(isPathAllowed('E:\\NotAllowed', allowedPaths)).toBe(false);
  });

  test('isPathAllowed is case insensitive', () => {
    expect(isPathAllowed('c:\\users\\TEST\\docs', allowedPaths)).toBe(true);
    expect(isPathAllowed('D:\\PROJECTS\\code', allowedPaths)).toBe(true);
  });

  test('validateWorkingDirectory throws for invalid paths', () => {
    expect(() => validateWorkingDirectory('relative/path', allowedPaths))
      .toThrow('Working directory must be an absolute path');
    expect(() => validateWorkingDirectory('E:\\NotAllowed', allowedPaths))
      .toThrow('Working directory must be within allowed paths');
  });
});

describe('Path Normalization', () => {
  test('normalizeWindowsPath handles various formats', () => {
    expect(normalizeWindowsPath('C:/Users/test')).toBe('C:\\Users\\test');
    expect(normalizeWindowsPath('\\Users\\test')).toBe('C:\\Users\\test');
    expect(normalizeWindowsPath('D:\\Projects')).toBe('D:\\Projects');
  });

  test('normalizeWindowsPath removes redundant separators', () => {
    expect(normalizeWindowsPath('C:\\\\Users\\\\test')).toBe('C:\\Users\\test');
    expect(normalizeWindowsPath('C:/Users//test')).toBe('C:\\Users\\test');
  });
});

describe('Shell Operator Validation', () => {
  const powershellConfig: ShellConfig = {
    enabled: true,
    command: 'powershell.exe',
    args: ['-Command'],
    blockedOperators: ['&', ';', '`']
  };

  test('validateShellOperators blocks dangerous operators', () => {
    expect(() => validateShellOperators('Get-Process & Get-Service', powershellConfig))
      .toThrow();
    expect(() => validateShellOperators('Get-Process; Start-Sleep', powershellConfig))
      .toThrow();
  });

  test('validateShellOperators allows safe operators when configured', () => {
    expect(() => validateShellOperators('Get-Process | Select-Object Name', powershellConfig))
      .not.toThrow();
    expect(() => validateShellOperators('$var = Get-Process', powershellConfig))
      .not.toThrow();
  });

  test('validateShellOperators respects shell config', () => {
    const customConfig: ShellConfig = {
      enabled: true,
      command: 'custom.exe',
      args: [],
      blockedOperators: ['|'] // Block only pipe operator
    };

    expect(() => validateShellOperators('cmd & echo test', customConfig))
      .not.toThrow();
    expect(() => validateShellOperators('cmd | echo test', customConfig))
      .toThrow();
  });
});

// v0.3.0 Security Enhancement Tests
describe('Dangerous Character Detection (v0.3.0)', () => {
  test('containsDangerousCharacters detects null bytes', () => {
    expect(containsDangerousCharacters('test\x00command')).toBe(true);
  });

  test('containsDangerousCharacters detects control characters', () => {
    expect(containsDangerousCharacters('test\x01command')).toBe(true);
    expect(containsDangerousCharacters('test\x08command')).toBe(true);
  });

  test('containsDangerousCharacters allows normal text', () => {
    expect(containsDangerousCharacters('normal command')).toBe(false);
    expect(containsDangerousCharacters('command with spaces')).toBe(false);
  });

  test('containsDangerousCharacters allows tabs and newlines', () => {
    expect(containsDangerousCharacters('command\ttab')).toBe(false);
    expect(containsDangerousCharacters('command\nnewline')).toBe(false);
  });
});

describe('Quote Validation (v0.3.0)', () => {
  test('parseCommand throws on unclosed double quotes', () => {
    expect(() => parseCommand('"unclosed')).toThrow('Unclosed " quote');
  });

  test('parseCommand throws on unclosed single quotes', () => {
    expect(() => parseCommand("'unclosed")).toThrow("Unclosed ' quote");
  });

  test('parseCommand handles properly closed quotes', () => {
    expect(() => parseCommand('"closed"')).not.toThrow();
    expect(() => parseCommand("'closed'")).not.toThrow();
  });
});

describe('Path Canonicalization (v0.3.0)', () => {
  test('canonicalizePath normalizes paths', () => {
    const result = canonicalizePath('C:\\test\\..\\final');
    expect(result).toContain('C:');
  });

  test('canonicalizePath handles non-existent paths', () => {
    const result = canonicalizePath('C:\\nonexistent\\path');
    expect(result).toContain('C:');
  });
});

describe('Enhanced Security Validation (v0.3.0)', () => {
  const shellConfig: ShellConfig = {
    enabled: true,
    command: 'cmd.exe',
    args: ['/c'],
    blockedOperators: ['&', '|', ';', '`', '>', '<']
  };

  test('blocks redirection operators', () => {
    expect(() => validateShellOperators('echo test > file.txt', shellConfig)).toThrow();
    expect(() => validateShellOperators('cat < input.txt', shellConfig)).toThrow();
    expect(() => validateShellOperators('echo test >> file.txt', shellConfig)).toThrow();
  });

  test('blocks Unicode operator variants', () => {
    expect(() => validateShellOperators('cmd ｜ echo', shellConfig)).toThrow('Unicode variant');
    expect(() => validateShellOperators('cmd ； echo', shellConfig)).toThrow('Unicode variant');
  });

  test('blocks control characters', () => {
    expect(() => validateShellOperators('cmd\x00test', shellConfig)).toThrow('control characters');
  });
});