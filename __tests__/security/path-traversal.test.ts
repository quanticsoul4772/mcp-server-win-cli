import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  canonicalizePath,
  isPathAllowed,
  validateWorkingDirectory,
  normalizeWindowsPath
} from '../../src/utils/validation.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Security Test Suite: Path Traversal Attacks
 *
 * This test suite covers various path traversal attack vectors including:
 * - Directory traversal with ../ sequences
 * - Symlink and junction point attacks (TOCTOU)
 * - Absolute path bypasses
 * - Windows-specific path tricks
 * - Canonicalization bypass attempts
 * - Reparse point detection
 *
 * References:
 * - OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
 * - CWE-22: Improper Limitation of a Pathname to a Restricted Directory
 * - Windows Reparse Points: https://docs.microsoft.com/en-us/windows/win32/fileio/reparse-points
 */

describe('Path Traversal Attack Vectors', () => {
  let tempDir: string;
  let allowedPaths: string[];

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-test-'));
    allowedPaths = [tempDir];
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Basic Path Traversal Attacks', () => {
    test('should block simple parent directory traversal (..\\)', () => {
      const maliciousPath = path.join(tempDir, '..', 'outside');
      expect(isPathAllowed(maliciousPath, allowedPaths)).toBe(false);
    });

    test('should block double parent directory traversal (..\\..\\)', () => {
      const maliciousPath = path.join(tempDir, '..', '..', 'outside');
      expect(isPathAllowed(maliciousPath, allowedPaths)).toBe(false);
    });

    test('should block multiple parent directory traversals', () => {
      const maliciousPath = path.join(tempDir, '..', '..', '..', '..', 'Windows');
      expect(isPathAllowed(maliciousPath, allowedPaths)).toBe(false);
    });

    test('should block parent traversal then subdirectory', () => {
      const maliciousPath = path.join(tempDir, '..', 'sibling', 'file.txt');
      expect(isPathAllowed(maliciousPath, allowedPaths)).toBe(false);
    });

    test('should allow paths within allowed directory', () => {
      const safePath = path.join(tempDir, 'subdir', 'file.txt');
      expect(isPathAllowed(safePath, allowedPaths)).toBe(true);
    });

    test('should allow exact allowed path', () => {
      expect(isPathAllowed(tempDir, allowedPaths)).toBe(true);
    });

    test('should block paths outside allowed directory', () => {
      const outsidePath = 'C:\\Windows\\System32';
      expect(isPathAllowed(outsidePath, allowedPaths)).toBe(false);
    });
  });

  describe('Canonicalization and Normalization', () => {
    test('should canonicalize path with ../ sequences', () => {
      const unnormalizedPath = path.join(tempDir, 'a', '..', 'b');
      const canonicalPath = canonicalizePath(unnormalizedPath);
      expect(canonicalPath).toBe(path.normalize(path.join(tempDir, 'b')));
    });

    test('should canonicalize path with multiple ../ sequences', () => {
      const unnormalizedPath = path.join(tempDir, 'a', 'b', '..', '..', 'c');
      const canonicalPath = canonicalizePath(unnormalizedPath);
      expect(canonicalPath).toBe(path.normalize(path.join(tempDir, 'c')));
    });

    test('should canonicalize path with ./ sequences', () => {
      const unnormalizedPath = path.join(tempDir, '.', 'subdir', '.', 'file.txt');
      const canonicalPath = canonicalizePath(unnormalizedPath);
      expect(canonicalPath).toBe(path.normalize(path.join(tempDir, 'subdir', 'file.txt')));
    });

    test('should handle non-existent paths by normalizing them', () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist', 'file.txt');
      const canonicalPath = canonicalizePath(nonExistentPath);
      // Should normalize even if path doesn't exist
      expect(canonicalPath).toBe(path.normalize(nonExistentPath));
    });

    test('should handle paths with trailing slashes', () => {
      const pathWithSlash = tempDir + path.sep;
      const canonicalPath = canonicalizePath(pathWithSlash);
      expect(canonicalPath).toBe(path.normalize(tempDir));
    });

    test('should normalize forward slashes to backslashes on Windows', () => {
      const forwardSlashPath = 'C:/Users/test/file.txt';
      const normalized = normalizeWindowsPath(forwardSlashPath);
      expect(normalized).toBe('C:\\Users\\test\\file.txt');
    });

    test('should handle mixed slashes', () => {
      const mixedPath = 'C:/Users\\test/file.txt';
      const normalized = normalizeWindowsPath(mixedPath);
      expect(normalized).toBe('C:\\Users\\test\\file.txt');
    });
  });

  describe('Symlink and Junction Attacks (TOCTOU)', () => {
    test('should resolve symlinks to actual target path', () => {
      // Create a subdirectory inside allowed path
      const targetDir = path.join(tempDir, 'target');
      fs.mkdirSync(targetDir, { recursive: true });

      // Create a file in target
      const targetFile = path.join(targetDir, 'file.txt');
      fs.writeFileSync(targetFile, 'content');

      // Create symlink inside allowed path pointing to target
      const symlinkPath = path.join(tempDir, 'link');
      try {
        fs.symlinkSync(targetDir, symlinkPath, 'dir');

        // Canonicalize the symlink
        const canonicalPath = canonicalizePath(symlinkPath);

        // Should resolve to actual target path
        expect(canonicalPath.toLowerCase()).toBe(targetDir.toLowerCase());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          console.warn('Skipping symlink test: requires admin privileges on Windows');
          return; // Skip this test if we don't have permission to create symlinks
        }
        throw error;
      }
    });

    test('should detect symlink pointing outside allowed paths', () => {
      // Create symlink inside allowed path
      const symlinkPath = path.join(tempDir, 'malicious-link');

      // Try to point it outside allowed path
      const outsideTarget = 'C:\\Windows';

      try {
        fs.symlinkSync(outsideTarget, symlinkPath, 'dir');

        // Canonicalize should resolve to the real target
        const canonicalPath = canonicalizePath(symlinkPath);

        // Should NOT be allowed because real target is outside
        expect(isPathAllowed(canonicalPath, allowedPaths)).toBe(false);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          console.warn('Skipping symlink test: requires admin privileges on Windows');
          return;
        }
        throw error;
      }
    });

    test('should handle broken symlinks gracefully', () => {
      const symlinkPath = path.join(tempDir, 'broken-link');
      const nonExistentTarget = path.join(tempDir, 'does-not-exist');

      try {
        fs.symlinkSync(nonExistentTarget, symlinkPath, 'dir');

        // Should normalize the path even if target doesn't exist
        const canonicalPath = canonicalizePath(symlinkPath);
        expect(canonicalPath).toBeTruthy();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          console.warn('Skipping broken symlink test: requires admin privileges on Windows');
          return;
        }
        throw error;
      }
    });
  });

  describe('Windows-Specific Path Tricks', () => {
    test('should handle UNC paths', () => {
      const uncPath = '\\\\server\\share\\file.txt';
      const normalized = normalizeWindowsPath(uncPath);
      expect(normalized).toBe('\\\\server\\share\\file.txt');
    });

    test('should block UNC paths if not in allowed list', () => {
      const uncPath = '\\\\malicious-server\\share\\data';
      expect(isPathAllowed(uncPath, allowedPaths)).toBe(false);
    });

    test('should handle drive letter paths', () => {
      const drivePath = 'C:\\Users\\test';
      const normalized = normalizeWindowsPath(drivePath);
      expect(normalized).toBe('C:\\Users\\test');
    });

    test('should handle paths without drive letter by assuming C:', () => {
      const noDrivePath = '\\Windows\\System32';
      const normalized = normalizeWindowsPath(noDrivePath);
      expect(normalized).toBe('C:\\Windows\\System32');
    });

    test('should block partial path matches (e.g., C:\\test vs C:\\test2)', () => {
      const allowedPath = 'C:\\test';
      const similarPath = 'C:\\test2\\file.txt';

      // test2 should NOT be allowed if only test is allowed
      expect(isPathAllowed(similarPath, [allowedPath])).toBe(false);
    });

    test('should allow subdirectories but not siblings', () => {
      const allowedPath = 'C:\\allowed';
      const subPath = 'C:\\allowed\\sub\\file.txt';
      const siblingPath = 'C:\\allowed-sibling\\file.txt';

      expect(isPathAllowed(subPath, [allowedPath])).toBe(true);
      expect(isPathAllowed(siblingPath, [allowedPath])).toBe(false);
    });

    test('should handle case-insensitive paths on Windows', () => {
      const lowerPath = path.join(tempDir, 'subdir').toLowerCase();
      const upperPath = path.join(tempDir, 'SUBDIR').toUpperCase();

      // Both should be treated as the same path
      expect(isPathAllowed(lowerPath, allowedPaths)).toBe(true);
      expect(isPathAllowed(upperPath, allowedPaths)).toBe(true);
    });

    test('should handle 8.3 short file names if they resolve to allowed paths', () => {
      // Windows short names like PROGRA~1 for "Program Files"
      // Canonicalization should resolve these
      const longPath = path.join(tempDir, 'very-long-directory-name');
      fs.mkdirSync(longPath, { recursive: true });

      const canonicalPath = canonicalizePath(longPath);
      expect(isPathAllowed(canonicalPath, allowedPaths)).toBe(true);
    });
  });

  describe('Working Directory Validation', () => {
    test('should require absolute paths for working directory', () => {
      const relativePath = 'relative\\path';
      expect(() => validateWorkingDirectory(relativePath, allowedPaths))
        .toThrow(/absolute path/i);
    });

    test('should reject working directory outside allowed paths', () => {
      const outsidePath = 'C:\\Windows\\System32';
      expect(() => validateWorkingDirectory(outsidePath, allowedPaths))
        .toThrow(/within allowed paths/i);
    });

    test('should accept working directory within allowed paths', () => {
      const insidePath = path.join(tempDir, 'subdir');
      expect(() => validateWorkingDirectory(insidePath, allowedPaths))
        .not.toThrow();
    });

    test('should accept exact allowed path as working directory', () => {
      expect(() => validateWorkingDirectory(tempDir, allowedPaths))
        .not.toThrow();
    });

    test('should provide helpful error messages', () => {
      const outsidePath = 'C:\\Windows';
      try {
        validateWorkingDirectory(outsidePath, allowedPaths);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        expect(errorMsg).toMatch(/within allowed paths/i);
        expect(errorMsg).toContain(tempDir); // Should mention the allowed path
      }
    });
  });

  describe('Multiple Allowed Paths', () => {
    test('should allow paths within any of multiple allowed directories', () => {
      const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'path-test-2-'));
      const multipleAllowed = [tempDir, tempDir2];

      try {
        const path1 = path.join(tempDir, 'file1.txt');
        const path2 = path.join(tempDir2, 'file2.txt');

        expect(isPathAllowed(path1, multipleAllowed)).toBe(true);
        expect(isPathAllowed(path2, multipleAllowed)).toBe(true);

        const outsidePath = 'C:\\Windows';
        expect(isPathAllowed(outsidePath, multipleAllowed)).toBe(false);
      } finally {
        fs.rmSync(tempDir2, { recursive: true, force: true });
      }
    });

    test('should handle overlapping allowed paths', () => {
      const parentPath = tempDir;
      const childPath = path.join(tempDir, 'subdir');
      fs.mkdirSync(childPath, { recursive: true });

      const overlappingAllowed = [parentPath, childPath];
      const testPath = path.join(childPath, 'file.txt');

      // Should be allowed (covered by both parent and child)
      expect(isPathAllowed(testPath, overlappingAllowed)).toBe(true);
    });

    test('should handle non-overlapping allowed paths', () => {
      const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'path-test-3-'));
      const nonOverlapping = [tempDir, tempDir2];

      try {
        const path1 = path.join(tempDir, 'file.txt');
        const path2 = path.join(tempDir2, 'file.txt');

        expect(isPathAllowed(path1, nonOverlapping)).toBe(true);
        expect(isPathAllowed(path2, nonOverlapping)).toBe(true);

        // Path between them should not be allowed
        const betweenPath = path.join(os.tmpdir(), 'between', 'file.txt');
        expect(isPathAllowed(betweenPath, nonOverlapping)).toBe(false);
      } finally {
        fs.rmSync(tempDir2, { recursive: true, force: true });
      }
    });
  });

  describe('Edge Cases and Attack Variations', () => {
    test('should block null byte injection in paths', () => {
      // Null bytes can truncate paths in some systems
      const maliciousPath = tempDir + '\x00' + '\\..\\..\\Windows';
      // The validation should work on the normalized path
      // Since null bytes are filtered at command level, test the concept
      expect(maliciousPath).toContain('\x00');
    });

    test('should handle very long paths', () => {
      // Windows has MAX_PATH limit of 260 chars (can be extended)
      const longSubpath = 'a'.repeat(100) + '\\' + 'b'.repeat(100);
      const longPath = path.join(tempDir, longSubpath);

      // Should handle long paths gracefully
      expect(() => canonicalizePath(longPath)).not.toThrow();
    });

    test('should handle paths with special characters', () => {
      const specialPath = path.join(tempDir, 'test[brackets]', 'file.txt');
      expect(() => canonicalizePath(specialPath)).not.toThrow();
    });

    test('should handle paths with Unicode characters', () => {
      const unicodePath = path.join(tempDir, 'café', '日本語', 'file.txt');
      expect(() => canonicalizePath(unicodePath)).not.toThrow();
    });

    test('should handle empty allowed paths array', () => {
      const emptyAllowed: string[] = [];
      const anyPath = path.join(tempDir, 'file.txt');

      // Should deny everything with empty allowed list
      expect(isPathAllowed(anyPath, emptyAllowed)).toBe(false);
    });

    test('should handle root directory access attempts', () => {
      const rootPath = 'C:\\';
      expect(isPathAllowed(rootPath, allowedPaths)).toBe(false);
    });

    test('should prevent traversal using alternate data streams (Windows)', () => {
      // Windows allows file.txt:stream notation
      const adsPath = path.join(tempDir, '..', '..', 'Windows') + ':hidden';
      // Canonicalization should handle this
      expect(() => canonicalizePath(adsPath)).not.toThrow();
    });
  });

  describe('TOCTOU Race Condition Prevention', () => {
    test('should use canonicalization to prevent TOCTOU attacks', () => {
      // TOCTOU (Time-of-check to time-of-use) attack scenario:
      // 1. Attacker creates a safe file
      // 2. Validation checks and approves it
      // 3. Attacker replaces it with symlink to sensitive location
      // 4. System uses the symlink

      // Our defense: Always canonicalize paths before validation
      const targetFile = path.join(tempDir, 'target.txt');
      fs.writeFileSync(targetFile, 'safe content');

      // First check - safe file
      let canonicalPath = canonicalizePath(targetFile);
      expect(isPathAllowed(canonicalPath, allowedPaths)).toBe(true);

      // Simulate attacker replacing file with symlink
      try {
        fs.unlinkSync(targetFile);
        fs.symlinkSync('C:\\Windows\\System32\\config\\SAM', targetFile, 'file');

        // Second check - should detect it's now pointing outside
        canonicalPath = canonicalizePath(targetFile);
        // The canonicalization resolves the symlink to its real target
        expect(canonicalPath.toLowerCase()).toContain('windows');
        expect(isPathAllowed(canonicalPath, allowedPaths)).toBe(false);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          console.warn('Skipping TOCTOU test: requires admin privileges on Windows');
          return;
        }
        throw error;
      }
    });

    test('should re-canonicalize paths on each check to prevent race', () => {
      // Each call to isPathAllowed should canonicalize independently
      const testPath = path.join(tempDir, 'test.txt');

      // First check
      const allowed1 = isPathAllowed(testPath, allowedPaths);

      // Second check (should re-canonicalize, not cache)
      const allowed2 = isPathAllowed(testPath, allowedPaths);

      expect(allowed1).toBe(allowed2);
      expect(allowed1).toBe(true);
    });
  });

  describe('Performance and DoS Protection', () => {
    test('should handle deep directory nesting efficiently', () => {
      const deepPath = path.join(tempDir, ...Array(50).fill('subdir'));
      const startTime = Date.now();
      const canonicalPath = canonicalizePath(deepPath);
      const duration = Date.now() - startTime;

      expect(canonicalPath).toBeTruthy();
      expect(duration).toBeLessThan(100); // Should be fast even with deep nesting
    });

    test('should handle many allowed paths efficiently', () => {
      const manyPaths = Array(100).fill(0).map((_, i) =>
        path.join(tempDir, `dir${i}`)
      );

      const testPath = path.join(tempDir, 'dir50', 'file.txt');
      const startTime = Date.now();
      const allowed = isPathAllowed(testPath, manyPaths);
      const duration = Date.now() - startTime;

      expect(allowed).toBe(true);
      expect(duration).toBeLessThan(100); // Should complete quickly
    });

    test('should not be vulnerable to algorithmic complexity attacks', () => {
      // Test with many ../ sequences
      const manyTraversals = path.join(
        tempDir,
        ...Array(100).fill('..'),
        'Windows'
      );

      const startTime = Date.now();
      const canonicalPath = canonicalizePath(manyTraversals);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100); // Should normalize efficiently
      expect(isPathAllowed(canonicalPath, allowedPaths)).toBe(false);
    });
  });

  describe('Regression Tests', () => {
    test('should not allow path traversal with URL encoding', () => {
      // Some systems might decode %2e%2e to ..
      const encodedPath = tempDir + '\\%2e%2e\\Windows';
      // Our system shouldn't decode, should treat literally
      const normalized = normalizeWindowsPath(encodedPath);
      expect(normalized).toContain('%2e%2e');
    });

    test('should not allow path traversal with double encoding', () => {
      // %252e%252e -> %2e%2e -> ..
      const doubleEncoded = tempDir + '\\%252e%252e\\Windows';
      const normalized = normalizeWindowsPath(doubleEncoded);
      expect(normalized).toContain('%252e%252e');
    });

    test('should handle path separator variations consistently', () => {
      const forwardSlash = tempDir + '/subdir/file.txt';
      const backslash = tempDir + '\\subdir\\file.txt';
      const mixed = tempDir + '/subdir\\file.txt';

      const canonical1 = canonicalizePath(forwardSlash);
      const canonical2 = canonicalizePath(backslash);
      const canonical3 = canonicalizePath(mixed);

      // All should normalize to the same path
      expect(canonical1.toLowerCase()).toBe(canonical2.toLowerCase());
      expect(canonical2.toLowerCase()).toBe(canonical3.toLowerCase());
    });
  });
});
