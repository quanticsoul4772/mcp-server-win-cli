import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let wslAvailableCache: boolean | null = null;

/**
 * Check if WSL is installed and available
 */
async function checkWSLAvailable(): Promise<boolean> {
  if (wslAvailableCache !== null) {
    return wslAvailableCache;
  }

  try {
    await execAsync('wsl --status', { timeout: 5000 });
    wslAvailableCache = true;
    return true;
  } catch {
    wslAvailableCache = false;
    return false;
  }
}

/**
 * Validate distribution name to prevent command injection
 */
function validateDistroName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Validate Unix path to prevent command injection
 */
function validateUnixPath(unixPath: string): boolean {
  return !/[;&|<>(){}]/.test(unixPath);
}

/**
 * Normalize local path for Node.js fs operations
 * Converts WSL network paths and Unix-style paths to Windows paths
 */
export async function normalizeLocalPath(localPath: string): Promise<string> {
  // Windows path - return as-is (exclude Unix-style paths starting with /)
  if (path.isAbsolute(localPath) && !localPath.startsWith('/') && !localPath.startsWith('\\\\wsl')) {
    return localPath;
  }

  // Check WSL availability for WSL paths
  const needsWSL = localPath.startsWith('\\\\wsl') || localPath.startsWith('/');
  if (needsWSL) {
    const available = await checkWSLAvailable();
    if (!available) {
      throw new Error('WSL is not installed or not available. Install WSL to use WSL paths.');
    }
  }

  // WSL network path
  if (localPath.startsWith('\\\\wsl.localhost\\') || localPath.startsWith('\\\\wsl$\\')) {
    return await resolveWSLNetworkPath(localPath);
  }

  // WSL mount path: /mnt/c/Users/...
  if (localPath.startsWith('/mnt/')) {
    return convertWSLMountPath(localPath);
  }

  // Unix absolute path: /home/user/...
  if (localPath.startsWith('/')) {
    return await convertUnixPathViaWSL(localPath);
  }

  return localPath;
}

/**
 * Check if path is a WSL-style path
 */
export function isWSLPath(localPath: string): boolean {
  return localPath.startsWith('\\\\wsl.localhost\\') ||
         localPath.startsWith('\\\\wsl$\\') ||
         localPath.startsWith('/mnt/') ||
         localPath.startsWith('/home/') ||
         localPath.startsWith('/root/');
}

/**
 * Convert WSL network path to Windows path
 */
async function resolveWSLNetworkPath(wslPath: string): Promise<string> {
  const parts = wslPath.replace(/\\/g, '/').split('/').filter(p => p);
  const distroName = parts[1];
  const unixPath = '/' + parts.slice(2).join('/');

  if (!validateDistroName(distroName)) {
    throw new Error(`Invalid WSL distribution name: ${distroName}`);
  }

  if (!validateUnixPath(unixPath)) {
    throw new Error(`Invalid Unix path: ${unixPath}`);
  }

  try {
    const { stdout } = await execAsync(`wsl -d ${distroName} wslpath -w "${unixPath}"`, { timeout: 5000 });
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to resolve WSL path ${wslPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Convert WSL mount path to Windows path
 * /mnt/c/Users/... -> C:\Users\...
 */
function convertWSLMountPath(wslPath: string): string {
  const match = wslPath.match(/^\/mnt\/([a-z])(\/.*)?$/i);
  if (!match) {
    throw new Error(`Invalid WSL mount path format: ${wslPath}`);
  }

  const drive = match[1].toUpperCase();
  const restPath = match[2] || '';
  return `${drive}:${restPath.replace(/\//g, '\\')}`;
}

/**
 * Convert Unix path to Windows path via WSL
 */
async function convertUnixPathViaWSL(unixPath: string): Promise<string> {
  if (!validateUnixPath(unixPath)) {
    throw new Error(`Invalid Unix path: ${unixPath}`);
  }

  try {
    const { stdout: distroList } = await execAsync('wsl -l -v', { timeout: 5000 });
    const lines = distroList.split('\n').slice(1);
    const distros = lines
      .map(line => {
        const match = line.match(/^\s*\*?\s*(\S+)/);
        return match ? match[1] : null;
      })
      .filter((d): d is string => d !== null && d !== 'NAME');

    if (distros.length === 0) {
      throw new Error('No WSL distributions found');
    }

    const defaultDistro = distros[0];

    if (!validateDistroName(defaultDistro)) {
      throw new Error(`Invalid default distribution name: ${defaultDistro}`);
    }

    const { stdout } = await execAsync(`wsl -d ${defaultDistro} wslpath -w "${unixPath}"`, { timeout: 5000 });
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to convert Unix path ${unixPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
