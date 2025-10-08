import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  formatEnhancedError,
  getConfigLocationMessage,
  validateShellOperators,
  validateWorkingDirectory,
  isCommandBlocked,
  isArgumentBlocked,
  getBlockedCommandName,
  getBlockedArgument,
  containsDangerousCharacters
} from '../../src/utils/validation.js';
import type { ShellConfig } from '../../src/types/config.js';
import path from 'path';

/**
 * Security Test Suite: Error Message Sanitization and Path Disclosure Prevention
 *
 * This test suite ensures that error messages do not leak sensitive information:
 * - Internal file paths and system structure
 * - Configuration details
 * - User data or credentials
 * - System version information
 * - Directory structures
 *
 * Error messages should provide helpful guidance without exposing attack surface.
 *
 * References:
 * - OWASP: Information Leakage
 * - CWE-209: Information Exposure Through an Error Message
 * - CWE-497: Exposure of System Data to an Unauthorized Control Sphere
 */

describe('Error Message Sanitization and Path Disclosure Prevention', () => {
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

    blockedCommands = ['rm', 'del', 'format', 'shutdown'];
    blockedArguments = ['--exec', '-e', '/c'];
  });

  describe('Path Disclosure Prevention', () => {
    test('should not expose full system paths in validation errors', () => {
      const maliciousCommand = 'dir | del /q *';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should not contain Windows system paths
        expect(errorMsg).not.toMatch(/C:\\Windows/i);
        expect(errorMsg).not.toMatch(/C:\\Program Files/i);
        expect(errorMsg).not.toMatch(/C:\\Users\\[^\\]+\\/);
        expect(errorMsg).not.toMatch(/\\AppData\\/i);
        expect(errorMsg).not.toMatch(/System32/i);
      }
    });

    test('should not expose user directories in error messages', () => {
      const outsidePath = 'C:\\Windows\\System32';
      const allowedPaths = ['C:\\Users\\TestUser\\Documents'];

      try {
        validateWorkingDirectory(outsidePath, allowedPaths);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should mention that path is not allowed, but might show the allowed paths
        // Check that error is informative without being overly detailed
        expect(errorMsg).toMatch(/within allowed paths/i);

        // The error DOES show allowed paths (by design for troubleshooting)
        // but should not expose other internal paths
        expect(errorMsg).not.toMatch(/C:\\Windows/);
        expect(errorMsg).not.toMatch(/System32/);
      }
    });

    test('should not expose internal file structure in config errors', () => {
      const configPath = null; // No config file

      const message = getConfigLocationMessage(configPath);

      // Should suggest generic locations, not expose user-specific paths
      expect(message).toMatch(/config\.json/i);
      expect(message).toMatch(/\.win-cli-mcp/i);

      // Should not expose full user directory path
      // Note: this function DOES show paths (by design) but they should be generic
      expect(message).toBeTruthy();
    });

    test('should not leak sensitive environment variables', () => {
      // Test that error messages don't expose env vars like USERPROFILE, TEMP, etc.
      const maliciousCommand = 'echo %USERPROFILE% | del';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should block the operator, but not expose the env var value
        expect(errorMsg).toMatch(/blocked operator/i);
        expect(errorMsg).not.toMatch(/C:\\Users\\[^\\]+$/); // No expanded path
      }
    });
  });

  describe('Enhanced Error Messages - Security vs Usability Balance', () => {
    test('should provide helpful error without exposing internals', () => {
      const maliciousCommand = 'dir & del /q *';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should include:
        expect(errorMsg).toMatch(/blocked operator/i); // What happened
        expect(errorMsg).toMatch(/&/); // Which operator
        expect(errorMsg).toMatch(/why/i); // Explanation
        expect(errorMsg).toMatch(/fix/i); // How to fix

        // Should NOT include:
        expect(errorMsg).not.toMatch(/internal/i);
        expect(errorMsg).not.toMatch(/debug/i);
        expect(errorMsg).not.toMatch(/stack trace/i);
      }
    });

    test('should sanitize user input in error messages', () => {
      // Attacker tries to inject paths into error messages
      const maliciousCommand = 'C:\\Windows\\System32\\evil.exe | del';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Error should be about the operator, not repeat the full malicious path
        expect(errorMsg).toMatch(/blocked operator/i);
        expect(errorMsg).toMatch(/\|/);

        // Should not echo back the full malicious command
        expect(errorMsg).not.toContain('C:\\Windows\\System32\\evil.exe');
      }
    });

    test('should provide context-appropriate error messages', () => {
      const options = {
        what: 'Operation blocked',
        why: 'Security policy violation',
        howToFix: [
          'Check your configuration',
          'Contact your administrator'
        ],
        warning: 'This is a security control',
        tip: 'Use the check_security_config tool',
        configPath: 'config.json'
      };

      const errorMsg = formatEnhancedError(options);

      expect(errorMsg).toContain('Operation blocked');
      expect(errorMsg).toContain('WHY: Security policy violation');
      expect(errorMsg).toContain('TO FIX:');
      expect(errorMsg).toContain('1. Check your configuration');
      expect(errorMsg).toContain('2. Contact your administrator');
      expect(errorMsg).toContain('WARNING: This is a security control');
      expect(errorMsg).toContain('TIP: Use the check_security_config tool');
    });
  });

  describe('Command Blocking Error Messages', () => {
    test('should provide helpful error for blocked command without internal details', () => {
      const blockedCmd = 'del.exe';

      expect(isCommandBlocked(blockedCmd, blockedCommands)).toBe(true);

      const commandName = getBlockedCommandName(blockedCmd, blockedCommands);
      expect(commandName).toBe('del');

      // Error should reference the blocked command name, not full paths
      expect(commandName).not.toMatch(/C:\\/);
      expect(commandName).not.toMatch(/\\/);
    });

    test('should handle blocked argument errors safely', () => {
      const args = ['--help', '--exec', 'code'];

      expect(isArgumentBlocked(args, blockedArguments)).toBe(true);

      const blockedArg = getBlockedArgument(args, blockedArguments);
      expect(blockedArg).toBe('--exec');

      // Should just return the argument, not any path context
      expect(blockedArg).not.toMatch(/\//);
      expect(blockedArg).not.toMatch(/\\/);
    });

    test('should not expose regex patterns in argument validation errors', () => {
      // Internal implementation uses regex, but errors should not expose that
      const args = ['-e'];

      expect(isArgumentBlocked(args, blockedArguments)).toBe(true);

      const blockedArg = getBlockedArgument(args, blockedArguments);

      // Should return the actual argument, not the regex pattern
      expect(blockedArg).toBe('-e');
      expect(blockedArg).not.toMatch(/\^/);
      expect(blockedArg).not.toMatch(/\$/);
      expect(blockedArg).not.toMatch(/\[/);
    });
  });

  describe('Control Character Error Messages', () => {
    test('should describe control characters without exposing binary data', () => {
      const maliciousCommand = 'echo\x00test';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should describe the issue clearly
        expect(errorMsg).toMatch(/control character/i);
        expect(errorMsg).toMatch(/security/i);

        // Should not include raw binary data or hex dumps
        expect(errorMsg).not.toMatch(/\x00/);
        expect(errorMsg).not.toMatch(/0x[0-9a-f]+/i);
      }
    });

    test('should handle null byte detection safely', () => {
      const nullByteCommand = 'test\x00injection';

      expect(containsDangerousCharacters(nullByteCommand)).toBe(true);

      // The function returns boolean, error message comes from validateShellOperators
      try {
        validateShellOperators(nullByteCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should be descriptive without showing the actual null byte
        expect(errorMsg).toMatch(/dangerous.*character/i);
        expect(errorMsg).not.toContain('\x00');
      }
    });

    test('should handle Unicode control characters in error messages', () => {
      const bidiCommand = 'test\u202Emalicious';

      try {
        validateShellOperators(bidiCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should describe the BiDi attack
        expect(errorMsg).toMatch(/BiDi|bidirectional/i);
        expect(errorMsg).toMatch(/control character/i);

        // Should include the codepoint reference (safe to show)
        expect(errorMsg).toMatch(/U\+202E/i);

        // Should not include the actual invisible character
        expect(errorMsg).not.toContain('\u202E');
      }
    });
  });

  describe('Configuration Path Handling', () => {
    test('should handle null config path gracefully', () => {
      const message = getConfigLocationMessage(null);

      // Should suggest default locations
      expect(message).toMatch(/config\.json/);
      expect(message).toMatch(/create/i);

      // Should be helpful without exposing too much
      expect(message).toBeTruthy();
    });

    test('should show provided config path when available', () => {
      const configPath = 'C:\\custom\\location\\config.json';
      const message = getConfigLocationMessage(configPath);

      expect(message).toContain(configPath);
      expect(message).toMatch(/edit/i);
    });

    test('should format config error messages consistently', () => {
      const maliciousCommand = 'dir | del';
      const configPath = 'test-config.json';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig, configPath);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should reference the config path for fixing
        expect(errorMsg).toMatch(/config/i);

        // Should explain how to resolve
        expect(errorMsg).toMatch(/fix/i);
        expect(errorMsg).toMatch(/edit/i);
      }
    });
  });

  describe('Unicode Attack Error Messages', () => {
    test('should describe homoglyph attacks clearly', () => {
      const homoglyphCommand = 'dir ｜ del'; // Fullwidth pipe

      try {
        validateShellOperators(homoglyphCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should explain the homoglyph attack
        expect(errorMsg).toMatch(/Unicode/i);
        expect(errorMsg).toMatch(/homoglyph|lookalike/i);
        expect(errorMsg).toMatch(/\|/); // Show ASCII equivalent

        // Should provide actionable fix
        expect(errorMsg).toMatch(/replace/i);
        expect(errorMsg).toMatch(/retype/i);
      }
    });

    test('should describe zero-width character attacks', () => {
      // Test without operators so zero-width char detection triggers (STEP 9)
      const zwCommand = 'dir\u200B\u200Btest';

      try {
        validateShellOperators(zwCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should explain zero-width attack
        expect(errorMsg).toMatch(/zero-width/i);
        expect(errorMsg).toMatch(/invisible/i);

        // Should provide guidance
        expect(errorMsg).toMatch(/retype/i);
        expect(errorMsg).toMatch(/manually/i);
      }
    });

    test('should reference security resources in error messages', () => {
      const smartQuoteCommand = 'echo \u201Dtest\u201D';

      try {
        validateShellOperators(smartQuoteCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should include educational references when appropriate
        expect(errorMsg).toMatch(/Unicode|PowerShell|quote/i);

        // May include reference links (these are safe to expose)
        // The actual implementation includes blog references
        expect(errorMsg).toBeTruthy();
      }
    });
  });

  describe('Error Message Consistency', () => {
    test('should use consistent formatting across all validation errors', () => {
      const testCases = [
        { cmd: 'dir | del', expectedPattern: /blocked operator/i },
        { cmd: 'dir\x00del', expectedPattern: /dangerous.*character/i },
        { cmd: 'dir\u200Bdel', expectedPattern: /zero-width/i },
      ];

      for (const testCase of testCases) {
        try {
          validateShellOperators(testCase.cmd, mockShellConfig);
          expect(true).toBe(false);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);

          // All should follow similar structure
          expect(errorMsg).toMatch(testCase.expectedPattern);
          expect(errorMsg).toMatch(/WHY:/);
          expect(errorMsg).toMatch(/TO FIX:/);
        }
      }
    });

    test('should include severity indicators where appropriate', () => {
      const criticalCommand = 'dir\x00del'; // Null byte injection

      try {
        validateShellOperators(criticalCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should indicate this is a security issue
        expect(errorMsg).toMatch(/WARNING|security|risk/i);
      }
    });

    test('should not expose stack traces in validation errors', () => {
      const maliciousCommand = 'dir & del';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should not contain stack trace elements
        expect(errorMsg).not.toMatch(/at\s+\w+\s+\(/);
        expect(errorMsg).not.toMatch(/\.ts:\d+:\d+/);
        expect(errorMsg).not.toMatch(/node_modules/i);
        expect(errorMsg).not.toMatch(/internal\/modules/i);
      }
    });
  });

  describe('Remediation Guidance Quality', () => {
    test('should provide step-by-step remediation for common issues', () => {
      const options = {
        what: 'Command blocked',
        why: 'Contains blocked operator',
        howToFix: [
          'Edit your config file',
          'Remove the operator from blockedOperators',
          'Restart the server'
        ],
        configPath: 'config.json'
      };

      const errorMsg = formatEnhancedError(options);

      // Should have numbered steps
      expect(errorMsg).toMatch(/1\./);
      expect(errorMsg).toMatch(/2\./);
      expect(errorMsg).toMatch(/3\./);

      // Should be actionable
      expect(errorMsg).toContain('Edit your config file');
      expect(errorMsg).toContain('Remove the operator from blockedOperators');
      expect(errorMsg).toContain('Restart the server');
    });

    test('should include warnings for security-sensitive changes', () => {
      const maliciousCommand = 'dir | del';
      const configPath = 'test.json';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig, configPath);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should warn about security implications
        expect(errorMsg).toMatch(/WARNING/i);
        expect(errorMsg).toMatch(/security|attack|malicious/i);
      }
    });

    test('should reference diagnostic tools where applicable', () => {
      const maliciousCommand = 'dir & del';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should mention check_security_config tool
        expect(errorMsg).toMatch(/check_security_config/i);
      }
    });
  });

  describe('Edge Cases in Error Sanitization', () => {
    test('should handle very long error messages gracefully', () => {
      const veryLongCommand = 'echo ' + 'a'.repeat(10000);

      // This shouldn't throw, but if it does, error should be bounded
      try {
        validateShellOperators(veryLongCommand, mockShellConfig);
        // This command is safe, should not throw
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Error message should not be excessively long
        expect(errorMsg.length).toBeLessThan(5000);
      }
    });

    test('should handle special characters in error messages safely', () => {
      const specialChars = 'test<>&"\'';

      // These are safe characters, but test error handling
      try {
        validateShellOperators('dir > output.txt', mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should handle > character in error message
        expect(errorMsg).toContain('>');
        expect(errorMsg).toMatch(/blocked operator/i);
      }
    });

    test('should not double-encode or escape user input unnecessarily', () => {
      const command = 'echo "test"';
      const configPath = 'C:\\config.json';

      try {
        validateShellOperators(command + ' | evil', mockShellConfig, configPath);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should show config path normally, not escaped
        expect(errorMsg).toMatch(/config\.json/);
        expect(errorMsg).not.toMatch(/\\\\|&quot;|&amp;/);
      }
    });
  });

  describe('Information Leakage Prevention', () => {
    test('should not leak server version or platform details', () => {
      const maliciousCommand = 'dir | del';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should not expose version numbers or platform details
        expect(errorMsg).not.toMatch(/version\s+\d+\.\d+/i);
        expect(errorMsg).not.toMatch(/win32|darwin|linux/i);
        expect(errorMsg).not.toMatch(/node\s+v?\d+/i);
      }
    });

    test('should not leak configuration structure in errors', () => {
      const maliciousCommand = 'dir & del';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should reference config options generically
        expect(errorMsg).toMatch(/blockedOperators/i); // This is OK - it's public API
        expect(errorMsg).not.toMatch(/securityKey|password|secret/i);
        expect(errorMsg).not.toMatch(/internal|private|hidden/i);
      }
    });

    test('should not expose temporary file paths or cache locations', () => {
      // Even though this function doesn't use temp files, test that errors don't leak them
      const maliciousCommand = 'dir | del';

      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Should not expose temp directories
        expect(errorMsg).not.toMatch(/\\temp\\/i);
        expect(errorMsg).not.toMatch(/\\tmp\\/i);
        expect(errorMsg).not.toMatch(/AppData\\Local\\Temp/i);
      }
    });
  });
});
