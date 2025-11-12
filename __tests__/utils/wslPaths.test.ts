import { jest } from '@jest/globals';
import { normalizeLocalPath, isWSLPath } from '../../src/utils/wslPaths.js';
import { exec } from 'child_process';

// Mock child_process.exec
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

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
      await expect(normalizeLocalPath('/mnt'))
        .rejects.toThrow('Invalid WSL mount path format');
    });
  });

  describe('normalizeLocalPath with WSL commands', () => {
    const mockExec = exec as jest.MockedFunction<typeof exec>;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('handles WSL not available gracefully', async () => {
      mockExec.mockImplementation((cmd, opts: any, callback: any) => {
        callback(new Error('Command failed: wsl --status'), '', 'wsl: command not found');
        return {} as any;
      });

      await expect(normalizeLocalPath('/home/user/file'))
        .rejects.toThrow('WSL is not installed or not available');
    });

    it('validates distribution name to prevent injection', async () => {
      mockExec.mockImplementation((cmd, opts: any, callback: any) => {
        if (cmd === 'wsl --status') {
          callback(null, 'Default Distribution: Ubuntu\nDefault Version: 2', '');
        }
        return {} as any;
      });

      const maliciousPath = '\\\\wsl.localhost\\Ubuntu$(rm -rf /)\\home\\user';

      await expect(normalizeLocalPath(maliciousPath))
        .rejects.toThrow('Invalid WSL distribution name');
    });

    it('validates Unix path to prevent injection', async () => {
      mockExec.mockImplementation((cmd, opts: any, callback: any) => {
        if (cmd === 'wsl --status') {
          callback(null, 'Default Distribution: Ubuntu\nDefault Version: 2', '');
        }
        return {} as any;
      });

      const maliciousPath = '/home/user; rm -rf /';

      await expect(normalizeLocalPath(maliciousPath))
        .rejects.toThrow('Invalid Unix path');
    });
  });
});
