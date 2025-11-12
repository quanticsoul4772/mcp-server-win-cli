import { normalizeLocalPath, isWSLPath } from '../../src/utils/wslPaths.js';

describe('wslPaths', () => {
  describe('isWSLPath', () => {
    it('detects WSL network paths', () => {
      expect(isWSLPath('\\\\wsl.localhost\\Ubuntu\\home\\user')).toBe(true);
      expect(isWSLPath('\\\\wsl$\\Ubuntu\\home\\user')).toBe(true);
    });

    it('detects WSL mount paths', () => {
      expect(isWSLPath('/mnt/c/Users/user')).toBe(true);
    });

    it('detects Unix absolute paths', () => {
      expect(isWSLPath('/home/user/file')).toBe(true);
      expect(isWSLPath('/root/file')).toBe(true);
    });

    it('rejects Windows paths', () => {
      expect(isWSLPath('C:\\Users\\user')).toBe(false);
    });

    it('rejects relative paths', () => {
      expect(isWSLPath('relative/path')).toBe(false);
    });
  });

  describe('normalizeLocalPath', () => {
    it('converts WSL mount paths', async () => {
      const result = await normalizeLocalPath('/mnt/c/Users/test');
      expect(result).toBe('C:\\Users\\test');
    });

    it('converts WSL mount paths with nested directories', async () => {
      const result = await normalizeLocalPath('/mnt/d/Projects/myapp/config.json');
      expect(result).toBe('D:\\Projects\\myapp\\config.json');
    });

    it('converts WSL mount path root', async () => {
      const result = await normalizeLocalPath('/mnt/c');
      expect(result).toBe('C:');
    });

    it('returns Windows paths unchanged', async () => {
      const result = await normalizeLocalPath('C:\\Users\\test');
      expect(result).toBe('C:\\Users\\test');
    });

    it('returns Windows network paths unchanged', async () => {
      const result = await normalizeLocalPath('\\\\server\\share\\file.txt');
      expect(result).toBe('\\\\server\\share\\file.txt');
    });

    it('throws on invalid WSL mount path', async () => {
      await expect(normalizeLocalPath('/mnt/'))
        .rejects.toThrow('Invalid WSL mount path format');
    });

    it('throws on invalid WSL mount path without drive', async () => {
      // /mnt without trailing slash is treated as Unix path, which triggers WSL command execution
      // This may fail due to WSL not being available or distribution issues
      await expect(normalizeLocalPath('/mnt'))
        .rejects.toThrow(); // Just check it throws, don't check specific message
    });
  });

  describe('normalizeLocalPath with WSL commands', () => {
    it('validates distribution name to prevent injection', async () => {
      // This test checks security validation that happens before any WSL commands
      // The path parsing will extract "Ubuntu$(rm -rf /)" as the distribution name
      // and validateDistroName() will reject it immediately
      const maliciousPath = '\\\\wsl.localhost\\Ubuntu$(rm -rf /)\\home\\user';

      await expect(normalizeLocalPath(maliciousPath))
        .rejects.toThrow('Invalid WSL distribution name');
    });

    it('validates Unix path to prevent injection', async () => {
      // This test checks security validation that happens before any WSL commands
      // validateUnixPath() will reject paths with shell operators immediately
      const maliciousPath = '/home/user; rm -rf /';

      await expect(normalizeLocalPath(maliciousPath))
        .rejects.toThrow('Invalid Unix path');
    });

    it('handles WSL not available gracefully', async () => {
      // Integration test: actually calls WSL, result depends on system state
      try {
        await normalizeLocalPath('/home/user/file');
        // If WSL is available and has a default distribution, this might succeed
        // That's fine - we're just verifying it doesn't crash
      } catch (error) {
        // If WSL is unavailable, verify the error message is helpful
        expect(error instanceof Error).toBe(true);
        if (error instanceof Error) {
          // Should either be "WSL not available" or a conversion error
          expect(
            error.message.includes('WSL is not installed') ||
            error.message.includes('Failed to convert Unix path')
          ).toBe(true);
        }
      }
    });
  });
});
