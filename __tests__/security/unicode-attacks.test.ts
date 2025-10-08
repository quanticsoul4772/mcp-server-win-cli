import { describe, test, expect, beforeEach } from '@jest/globals';
import { validateShellOperators, containsDangerousCharacters } from '../../src/utils/validation.js';
import type { ShellConfig } from '../../src/types/config.js';

/**
 * Security Test Suite: Unicode-Based Attacks
 *
 * This test suite covers various Unicode-based attack vectors including:
 * - Homoglyphs (lookalike characters)
 * - Bidirectional text override (BiDi attacks)
 * - Zero-width characters
 * - Unicode normalization attacks
 * - Full-width character substitution
 * - PowerShell smart quotes (U+201D)
 *
 * References:
 * - OWASP Unicode Encoding: https://owasp.org/www-community/attacks/Unicode_Encoding
 * - Unicode Security Guide: https://unicode.org/reports/tr36/
 */

describe('Unicode Attack Vectors', () => {
  let mockShellConfig: ShellConfig;

  beforeEach(() => {
    mockShellConfig = {
      enabled: true,
      command: 'cmd.exe',
      args: ['/c'],
      blockedOperators: ['&', '|', ';', '`']
    };
  });

  describe('Homoglyph Attacks - Pipe Operator (|)', () => {
    test('should block fullwidth vertical line (U+FF5C)', () => {
      const maliciousCommand = 'dir ｜ del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*\|/);
    });

    test('should block box drawings light vertical (U+2502)', () => {
      const maliciousCommand = 'dir │ del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*\|/);
    });

    test('should block vertical line extension (U+23D0)', () => {
      const maliciousCommand = 'dir ⏐ del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*\|/);
    });

    test('should block divides symbol (U+2223)', () => {
      const maliciousCommand = 'dir ∣ del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*\|/);
    });

    test('should block Latin letter dental click (U+01C0)', () => {
      const maliciousCommand = 'dir ǀ del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*\|/);
    });

    test('should allow legitimate vertical bar in quoted strings', () => {
      // Legitimate use: the actual ASCII pipe in a string should still be blocked
      const quotedCommand = 'echo "test | value"';
      // The actual | character should still be blocked even in quotes
      expect(() => validateShellOperators(quotedCommand, mockShellConfig))
        .toThrow(/blocked operator.*\|/);
    });
  });

  describe('Homoglyph Attacks - Semicolon Operator (;)', () => {
    test('should block fullwidth semicolon (U+FF1B)', () => {
      const maliciousCommand = 'dir； del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*;/);
    });

    test('should block runic single punctuation (U+16EB)', () => {
      const maliciousCommand = 'dir ᛫ del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*;/);
    });

    test('should block presentation form vertical semicolon (U+FE14)', () => {
      const maliciousCommand = 'dir ︔ del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*;/);
    });
  });

  describe('Homoglyph Attacks - Ampersand Operator (&)', () => {
    test('should block fullwidth ampersand (U+FF06)', () => {
      const maliciousCommand = 'dir ＆ del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*&/);
    });

    test('should block small ampersand (U+FE60)', () => {
      const maliciousCommand = 'dir ﹠ del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*&/);
    });
  });

  describe('Homoglyph Attacks - Redirection Operators (>, <)', () => {
    test('should block fullwidth greater-than (U+FF1E)', () => {
      const maliciousCommand = 'echo malicious ＞ evil.bat';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*>/);
    });

    test('should block single right-pointing angle quotation (U+203A)', () => {
      const maliciousCommand = 'echo malicious › evil.bat';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*>/);
    });

    test('should block heavy right-pointing angle quotation (U+276F)', () => {
      const maliciousCommand = 'echo malicious ❯ evil.bat';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*>/);
    });

    test('should block fullwidth less-than (U+FF1C)', () => {
      const maliciousCommand = 'malware ＜ input.txt';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*</);
    });

    test('should block single left-pointing angle quotation (U+2039)', () => {
      const maliciousCommand = 'malware ‹ input.txt';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*</);
    });

    test('should block heavy left-pointing angle quotation (U+276E)', () => {
      const maliciousCommand = 'malware ❮ input.txt';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant of blocked operator.*</);
    });
  });

  describe('Zero-Width Character Attacks', () => {
    test('should block zero-width space (U+200B)', () => {
      // Test zero-width without operators so it gets caught by zero-width detection (STEP 9)
      const maliciousCommand = 'dir\u200B\u200Btest';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/zero-width characters/i);
    });

    test('should block zero-width non-joiner (U+200C)', () => {
      // Test zero-width without operators
      const maliciousCommand = 'dir\u200C\u200Ctest';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/zero-width characters/i);
    });

    test('should block zero-width joiner (U+200D)', () => {
      // Test zero-width without operators
      const maliciousCommand = 'dir\u200D\u200Dtest';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/zero-width characters/i);
    });

    test('should block zero-width no-break space / BOM (U+FEFF)', () => {
      // Test zero-width without operators
      const maliciousCommand = 'dir\uFEFF\uFEFFtest';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/zero-width characters/i);
    });

    test('should block zero-width characters used to obfuscate commands', () => {
      // Zero-width chars can hide malicious intent in command names
      const maliciousCommand = 'echo\u200B\u200Btest';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/zero-width characters/i);
    });

    test('should block multiple zero-width characters in sequence', () => {
      // Multiple zero-width chars in sequence
      const maliciousCommand = 'dir\u200B\u200C\u200D\uFEFFtest';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/zero-width characters/i);
    });
  });

  describe('Bidirectional Text Override (BiDi) Attacks', () => {
    test('should block Right-to-Left Override (U+202E)', () => {
      // BiDi override can disguise malicious commands - test without operators
      const maliciousCommand = 'echo safe\u202E"tset"';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Bidirectional.*BiDi.*control character/i);
    });

    test('should block Left-to-Right Override (U+202D)', () => {
      const maliciousCommand = 'echo\u202D test';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Bidirectional.*BiDi.*control character/i);
    });

    test('should block Right-to-Left Embedding (U+202B)', () => {
      const maliciousCommand = 'test\u202B evil';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Bidirectional.*BiDi.*control character/i);
    });

    test('should block Left-to-Right Embedding (U+202A)', () => {
      const maliciousCommand = 'test\u202A evil';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Bidirectional.*BiDi.*control character/i);
    });

    test('should block Pop Directional Formatting (U+202C)', () => {
      const maliciousCommand = 'test\u202C evil';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Bidirectional.*BiDi.*control character/i);
    });
  });

  describe('PowerShell Smart Quote Attacks', () => {
    test('should block right double quotation mark (U+201D) - PowerShell smart quote', () => {
      // In PowerShell, U+201D can sometimes be interpreted as a quote
      const maliciousCommand = 'echo \u201Dtest\u201D';
      // This should be caught by PowerShell Unicode quote detection (STEP 2)
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/PowerShell Unicode quote/i);
    });

    test('should block left double quotation mark (U+201C)', () => {
      const maliciousCommand = 'echo \u201Ctest\u201C';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/PowerShell Unicode quote/i);
    });

    test('should block right single quotation mark (U+2019)', () => {
      const maliciousCommand = 'echo \u2019test\u2019';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/PowerShell Unicode quote/i);
    });

    test('should block left single quotation mark (U+2018)', () => {
      const maliciousCommand = 'echo \u2018test\u2018';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/PowerShell Unicode quote/i);
    });
  });

  describe('Null Byte Injection', () => {
    test('should block null byte (U+0000)', () => {
      const maliciousCommand = 'dir\x00 | del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/dangerous control characters/i);
    });

    test('should block null byte in middle of command', () => {
      const maliciousCommand = 'echo test\x00malicious';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/dangerous control characters/i);
    });

    test('should detect null bytes via containsDangerousCharacters', () => {
      const maliciousCommand = 'command\x00injection';
      expect(containsDangerousCharacters(maliciousCommand)).toBe(true);
    });
  });

  describe('Control Character Injection', () => {
    test('should block SOH (Start of Heading - U+0001)', () => {
      const maliciousCommand = 'echo\x01test';
      expect(containsDangerousCharacters(maliciousCommand)).toBe(true);
    });

    test('should block STX (Start of Text - U+0002)', () => {
      const maliciousCommand = 'echo\x02test';
      expect(containsDangerousCharacters(maliciousCommand)).toBe(true);
    });

    test('should block ETX (End of Text - U+0003)', () => {
      const maliciousCommand = 'echo\x03test';
      expect(containsDangerousCharacters(maliciousCommand)).toBe(true);
    });

    test('should block BEL (Bell - U+0007)', () => {
      const maliciousCommand = 'echo\x07test';
      expect(containsDangerousCharacters(maliciousCommand)).toBe(true);
    });

    test('should block BS (Backspace - U+0008)', () => {
      const maliciousCommand = 'echo\x08test';
      expect(containsDangerousCharacters(maliciousCommand)).toBe(true);
    });

    test('should allow tab (U+0009)', () => {
      // Tab is explicitly allowed
      const safeCommand = 'echo\ttest';
      expect(containsDangerousCharacters(safeCommand)).toBe(false);
    });

    test('should allow newline (U+000A)', () => {
      // Newline is explicitly allowed
      const safeCommand = 'echo\ntest';
      expect(containsDangerousCharacters(safeCommand)).toBe(false);
    });

    test('should block vertical tab (U+000B)', () => {
      const maliciousCommand = 'echo\x0Btest';
      expect(containsDangerousCharacters(maliciousCommand)).toBe(true);
    });

    test('should block form feed (U+000C)', () => {
      const maliciousCommand = 'echo\x0Ctest';
      expect(containsDangerousCharacters(maliciousCommand)).toBe(true);
    });

    test('should allow carriage return (U+000D) for Windows line endings', () => {
      // Carriage return is allowed since Windows uses \r\n line endings
      const windowsCommand = 'echo\rtest';
      expect(containsDangerousCharacters(windowsCommand)).toBe(false);
    });

    test('should block escape (U+001B)', () => {
      const maliciousCommand = 'echo\x1Btest';
      expect(containsDangerousCharacters(maliciousCommand)).toBe(true);
    });

    test('should block DEL (U+007F)', () => {
      const maliciousCommand = 'echo\x7Ftest';
      expect(containsDangerousCharacters(maliciousCommand)).toBe(true);
    });
  });

  describe('Combined Attack Vectors', () => {
    test('should block homoglyph + zero-width character combination', () => {
      const maliciousCommand = 'dir\u200B｜\u200Bdel /q *';
      // Defense in depth: will catch FIRST attack in pipeline (homoglyph variant detected in STEP 8)
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Unicode variant|zero-width/i);
    });

    test('should block BiDi + operator combination', () => {
      const maliciousCommand = 'echo\u202E test';
      // BiDi detected in STEP 3 (before operator check in STEP 7)
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/Bidirectional.*BiDi/i);
    });

    test('should block multiple different Unicode attacks in single command', () => {
      const maliciousCommand = 'test\u200B｜\u202E\uFEFF';
      // Will catch FIRST attack in pipeline order
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/zero-width|Unicode variant|Bidirectional.*BiDi/i);
    });
  });

  describe('Edge Cases and Regression Tests', () => {
    test('should allow normal ASCII commands', () => {
      const safeCommand = 'dir C:\\Windows';
      expect(() => validateShellOperators(safeCommand, mockShellConfig)).not.toThrow();
    });

    test('should allow commands with legitimate Unicode text (non-operator)', () => {
      // Legitimate Unicode in text, not trying to bypass operators
      const safeCommand = 'echo Café résumé 日本語';
      expect(() => validateShellOperators(safeCommand, mockShellConfig)).not.toThrow();
    });

    test('should still block actual ASCII operators', () => {
      const maliciousCommand = 'dir | del /q *';
      expect(() => validateShellOperators(maliciousCommand, mockShellConfig))
        .toThrow(/blocked operator.*\|/);
    });

    test('should handle empty blockedOperators array', () => {
      const permissiveConfig: ShellConfig = {
        enabled: true,
        command: 'cmd.exe',
        args: ['/c'],
        blockedOperators: []
      };
      // Should still block control characters even with no operator blocking
      const controlCharCommand = 'echo\x00test';
      expect(() => validateShellOperators(controlCharCommand, permissiveConfig))
        .toThrow(/dangerous control characters/i);
    });

    test('should provide helpful error messages for Unicode variants', () => {
      const maliciousCommand = 'dir ｜ del /q *';
      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        expect(errorMsg).toMatch(/Unicode variant/i);
        expect(errorMsg).toMatch(/homoglyph/i);
        expect(errorMsg).toMatch(/\|/); // Should mention the ASCII equivalent
      }
    });

    test('should provide helpful error messages for zero-width characters', () => {
      // Test without operators so zero-width detection triggers
      const maliciousCommand = 'dir\u200B\u200Btest';
      try {
        validateShellOperators(maliciousCommand, mockShellConfig);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        expect(errorMsg).toMatch(/zero-width/i);
        expect(errorMsg).toMatch(/invisible/i);
        expect(errorMsg).toMatch(/bypass/i);
      }
    });
  });

  describe('Performance and DOS Protection', () => {
    test('should handle very long commands with Unicode efficiently', () => {
      // Create a long command with legitimate Unicode
      const longCommand = 'echo ' + 'café'.repeat(1000);
      const startTime = Date.now();
      expect(() => validateShellOperators(longCommand, mockShellConfig)).not.toThrow();
      const duration = Date.now() - startTime;
      // Should complete in reasonable time (< 100ms even for 4000+ char command)
      expect(duration).toBeLessThan(100);
    });

    test('should handle commands with many different Unicode characters', () => {
      // Mix of legitimate Unicode
      const unicodeCommand = 'echo café 日本語 🎉 résumé München';
      expect(() => validateShellOperators(unicodeCommand, mockShellConfig)).not.toThrow();
    });
  });
});
