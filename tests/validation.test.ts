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
  canonicalizePath,
  normalizeUnicode,
  detectPowerShellUnicodeQuotes,
  detectBidiControlCharacters,
  detectSuspiciousCombiningCharacters,
  detectInvisibleUnicodeCharacters
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
    expect(isCommandBlocked('format.com', blockedCommands)).toBe(true); // .com now blocked
    expect(isCommandBlocked('del.ps1', blockedCommands)).toBe(true); // .ps1 now blocked
    expect(isCommandBlocked('format.vbs', blockedCommands)).toBe(true); // .vbs now blocked
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

  test('parseCommand handles escaped quotes', () => {
    expect(parseCommand('echo "test \\" quote"')).toEqual({
      command: 'echo',
      args: ['test " quote']
    });
    expect(parseCommand("echo 'test \\' quote'")).toEqual({
      command: 'echo',
      args: ["test ' quote"]
    });
  });

  test('parseCommand handles escaped backslashes', () => {
    expect(parseCommand('echo "path\\\\with\\\\backslashes"')).toEqual({
      command: 'echo',
      args: ['path\\with\\backslashes']
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

  test('blocks additional Unicode pipe homoglyphs', () => {
    expect(() => validateShellOperators('cmd │ echo', shellConfig)).toThrow('Unicode variant');
    expect(() => validateShellOperators('cmd ⏐ echo', shellConfig)).toThrow('Unicode variant');
  });

  test('blocks zero-width characters', () => {
    expect(() => validateShellOperators('cmd\u200Becho', shellConfig)).toThrow('zero-width');
    expect(() => validateShellOperators('cmd\uFEFFecho', shellConfig)).toThrow('zero-width');
  });
});

describe('Enhanced Unicode Security (v0.4.0)', () => {
  const shellConfig: ShellConfig = {
    enabled: true,
    command: 'powershell.exe',
    args: ['-Command'],
    blockedOperators: ['&', '|', ';', '`', '>', '<']
  };

  describe('PowerShell Unicode Quote Detection', () => {
    test('blocks U+201C LEFT DOUBLE QUOTATION MARK', () => {
      expect(() => validateShellOperators('Write-Host \u201CHello\u201D', shellConfig))
        .toThrow('PowerShell Unicode quote');
    });

    test('blocks U+201D RIGHT DOUBLE QUOTATION MARK', () => {
      expect(() => validateShellOperators('Get-Process \u201D', shellConfig))
        .toThrow('PowerShell Unicode quote');
    });

    test('blocks U+2018 LEFT SINGLE QUOTATION MARK', () => {
      expect(() => validateShellOperators('Write-Host \u2018Hello\u2019', shellConfig))
        .toThrow('PowerShell Unicode quote');
    });

    test('blocks U+2019 RIGHT SINGLE QUOTATION MARK', () => {
      expect(() => validateShellOperators('Get-Item \u2019test\u2019', shellConfig))
        .toThrow('PowerShell Unicode quote');
    });

    test('blocks U+2033 DOUBLE PRIME', () => {
      expect(() => validateShellOperators('cmd \u2033test\u2033', shellConfig))
        .toThrow('PowerShell Unicode quote');
    });

    test('blocks U+2032 PRIME', () => {
      expect(() => validateShellOperators('cmd \u2032test\u2032', shellConfig))
        .toThrow('PowerShell Unicode quote');
    });

    test('allows standard ASCII quotes', () => {
      expect(() => validateShellOperators('Write-Host "Hello"', shellConfig))
        .not.toThrow();
      expect(() => validateShellOperators("Write-Host 'Hello'", shellConfig))
        .not.toThrow();
    });
  });

  describe('BiDi Control Character Detection (CVE-2021-42574)', () => {
    test('blocks U+202E RIGHT-TO-LEFT OVERRIDE (RLO)', () => {
      expect(() => validateShellOperators('cmd \u202E test', shellConfig))
        .toThrow('BiDi');
      expect(() => validateShellOperators('cmd \u202E test', shellConfig))
        .toThrow('CVE-2021-42574');
    });

    test('blocks U+202D LEFT-TO-RIGHT OVERRIDE (LRO)', () => {
      expect(() => validateShellOperators('cmd \u202D test', shellConfig))
        .toThrow('BiDi');
    });

    test('blocks U+202A LEFT-TO-RIGHT EMBEDDING (LRE)', () => {
      expect(() => validateShellOperators('cmd \u202A test', shellConfig))
        .toThrow('BiDi');
    });

    test('blocks U+202B RIGHT-TO-LEFT EMBEDDING (RLE)', () => {
      expect(() => validateShellOperators('cmd \u202B test', shellConfig))
        .toThrow('BiDi');
    });

    test('blocks U+202C POP DIRECTIONAL FORMATTING (PDF)', () => {
      expect(() => validateShellOperators('cmd \u202C test', shellConfig))
        .toThrow('BiDi');
    });

    test('blocks U+2066 LEFT-TO-RIGHT ISOLATE (LRI)', () => {
      expect(() => validateShellOperators('cmd \u2066 test', shellConfig))
        .toThrow('BiDi');
    });

    test('blocks U+2067 RIGHT-TO-LEFT ISOLATE (RLI)', () => {
      expect(() => validateShellOperators('cmd \u2067 test', shellConfig))
        .toThrow('BiDi');
    });

    test('blocks U+2068 FIRST STRONG ISOLATE (FSI)', () => {
      expect(() => validateShellOperators('cmd \u2068 test', shellConfig))
        .toThrow('BiDi');
    });

    test('blocks U+2069 POP DIRECTIONAL ISOLATE (PDI)', () => {
      expect(() => validateShellOperators('cmd \u2069 test', shellConfig))
        .toThrow('BiDi');
    });

    test('error message references Trojan Source attack', () => {
      expect(() => validateShellOperators('cmd \u202E malicious', shellConfig))
        .toThrow('Trojan Source');
    });
  });

  describe('Combining Character Detection', () => {
    test('blocks combining diacritical marks (U+0300-U+036F)', () => {
      expect(() => validateShellOperators('cmd\u0301 test', shellConfig))
        .toThrow('combining');
    });

    test('blocks combining marks for symbols (U+20D0-U+20FF)', () => {
      expect(() => validateShellOperators('cmd\u20D0 test', shellConfig))
        .toThrow('combining');
    });

    test('allows normal accented characters (pre-composed)', () => {
      expect(() => validateShellOperators('Write-Host café', shellConfig))
        .not.toThrow();
    });
  });

  describe('Invisible Unicode Character Detection', () => {
    test('blocks variation selectors', () => {
      expect(() => validateShellOperators('cmd\uFE00 test', shellConfig))
        .toThrow('invisible');
      expect(() => validateShellOperators('cmd\uFE0F test', shellConfig))
        .toThrow('invisible');
    });

    test('blocks word joiner (U+2060)', () => {
      expect(() => validateShellOperators('cmd\u2060test', shellConfig))
        .toThrow('invisible');
    });

    test('blocks invisible times/separator/plus', () => {
      expect(() => validateShellOperators('cmd\u2062test', shellConfig))
        .toThrow('invisible');
      expect(() => validateShellOperators('cmd\u2063test', shellConfig))
        .toThrow('invisible');
      expect(() => validateShellOperators('cmd\u2064test', shellConfig))
        .toThrow('invisible');
    });

    test('blocks soft hyphen (U+00AD)', () => {
      expect(() => validateShellOperators('cmd\u00ADtest', shellConfig))
        .toThrow('invisible');
    });

    test('blocks Arabic form shaping controls', () => {
      expect(() => validateShellOperators('cmd\u206C test', shellConfig))
        .toThrow('invisible');
      expect(() => validateShellOperators('cmd\u206D test', shellConfig))
        .toThrow('invisible');
    });
  });

  describe('Unicode Normalization', () => {
    test('normalizes text before validation', () => {
      // The normalization happens first, so decomposed forms are normalized
      // to composed forms before validation. This means legitimate accented
      // text works correctly.
      const decomposed = 'cafe\u0301'; // café with combining accent

      // After normalization, this becomes composed form and is allowed
      expect(() => validateShellOperators(decomposed, shellConfig))
        .not.toThrow();

      // But standalone combining characters (not part of valid composition) are still blocked
      expect(() => validateShellOperators('cmd\u0301', shellConfig))
        .toThrow('combining');
    });
  });

  describe('Multiple Unicode Attack Vectors', () => {
    test('detects first Unicode threat in order', () => {
      // PowerShell quote should be detected before BiDi
      expect(() => validateShellOperators('\u201C\u202E test', shellConfig))
        .toThrow('PowerShell Unicode quote');
    });

    test('comprehensive attack command is blocked', () => {
      const malicious = 'Get-Process \u201D\u202E\u200B; rm -rf /';
      expect(() => validateShellOperators(malicious, shellConfig))
        .toThrow();
    });
  });
});

describe('Unicode Detection Functions (v0.4.0)', () => {
  describe('normalizeUnicode', () => {
    test('normalizes text to NFC form', () => {
      const decomposed = 'cafe\u0301'; // café with combining accent
      const composed = 'café'; // café as single character
      expect(normalizeUnicode(decomposed)).toBe(normalizeUnicode(composed));
    });

    test('handles empty strings', () => {
      expect(normalizeUnicode('')).toBe('');
    });

    test('handles ASCII text unchanged', () => {
      expect(normalizeUnicode('hello world')).toBe('hello world');
    });
  });

  describe('detectPowerShellUnicodeQuotes', () => {
    test('detects left double quotation mark', () => {
      const result = detectPowerShellUnicodeQuotes('test \u201C quote');
      expect(result.detected).toBe(true);
      expect(result.codepoint).toContain('U+201C');
    });

    test('detects right double quotation mark', () => {
      const result = detectPowerShellUnicodeQuotes('test \u201D quote');
      expect(result.detected).toBe(true);
      expect(result.codepoint).toContain('U+201D');
    });

    test('detects single quotation marks', () => {
      expect(detectPowerShellUnicodeQuotes('test \u2018 quote').detected).toBe(true);
      expect(detectPowerShellUnicodeQuotes('test \u2019 quote').detected).toBe(true);
    });

    test('returns false for normal quotes', () => {
      const result = detectPowerShellUnicodeQuotes('test "normal" quote');
      expect(result.detected).toBe(false);
    });
  });

  describe('detectBidiControlCharacters', () => {
    test('detects RIGHT-TO-LEFT OVERRIDE', () => {
      const result = detectBidiControlCharacters('test \u202E malicious');
      expect(result.detected).toBe(true);
      expect(result.codepoint).toContain('U+202E');
      expect(result.codepoint).toContain('RLO');
    });

    test('detects all BiDi control characters', () => {
      expect(detectBidiControlCharacters('test \u202D').detected).toBe(true); // LRO
      expect(detectBidiControlCharacters('test \u202A').detected).toBe(true); // LRE
      expect(detectBidiControlCharacters('test \u202B').detected).toBe(true); // RLE
      expect(detectBidiControlCharacters('test \u202C').detected).toBe(true); // PDF
      expect(detectBidiControlCharacters('test \u2066').detected).toBe(true); // LRI
      expect(detectBidiControlCharacters('test \u2067').detected).toBe(true); // RLI
      expect(detectBidiControlCharacters('test \u2068').detected).toBe(true); // FSI
      expect(detectBidiControlCharacters('test \u2069').detected).toBe(true); // PDI
    });

    test('returns false for normal text', () => {
      const result = detectBidiControlCharacters('normal command');
      expect(result.detected).toBe(false);
    });
  });

  describe('detectSuspiciousCombiningCharacters', () => {
    test('detects combining diacritical marks', () => {
      const result = detectSuspiciousCombiningCharacters('test\u0301');
      expect(result.detected).toBe(true);
      expect(result.position).toBe(4);
    });

    test('detects combining marks for symbols', () => {
      const result = detectSuspiciousCombiningCharacters('test\u20D0');
      expect(result.detected).toBe(true);
    });

    test('returns false for pre-composed characters', () => {
      const result = detectSuspiciousCombiningCharacters('café'); // é is pre-composed
      expect(result.detected).toBe(false);
    });

    test('returns false for normal ASCII', () => {
      const result = detectSuspiciousCombiningCharacters('normal text');
      expect(result.detected).toBe(false);
    });
  });

  describe('detectInvisibleUnicodeCharacters', () => {
    test('detects variation selectors', () => {
      expect(detectInvisibleUnicodeCharacters('test\uFE00').detected).toBe(true);
      expect(detectInvisibleUnicodeCharacters('test\uFE0F').detected).toBe(true);
    });

    test('detects word joiner and invisible operators', () => {
      expect(detectInvisibleUnicodeCharacters('test\u2060').detected).toBe(true);
      expect(detectInvisibleUnicodeCharacters('test\u2062').detected).toBe(true);
      expect(detectInvisibleUnicodeCharacters('test\u2063').detected).toBe(true);
    });

    test('detects soft hyphen', () => {
      const result = detectInvisibleUnicodeCharacters('test\u00AD');
      expect(result.detected).toBe(true);
      expect(result.codepoint).toContain('SOFT HYPHEN');
    });

    test('returns false for normal text', () => {
      const result = detectInvisibleUnicodeCharacters('normal command');
      expect(result.detected).toBe(false);
    });
  });
});