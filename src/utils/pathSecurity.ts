import path from 'path';
import { normalizeLocalPath } from './wslPaths.js';

/**
 * Validate that a path is within allowed paths
 * Handles both Windows and WSL paths
 */
export async function validatePathAllowed(
  targetPath: string,
  allowedPaths: string[],
  restrictWorkingDirectory: boolean
): Promise<{ allowed: boolean; error?: string }> {
  if (!restrictWorkingDirectory) {
    return { allowed: true };
  }

  const resolvedTarget = path.resolve(targetPath);

  for (const allowedPath of allowedPaths) {
    try {
      // Normalize allowedPath (handles WSL paths in config)
      const normalizedAllowed = await normalizeLocalPath(allowedPath);
      const resolvedAllowed = path.resolve(normalizedAllowed);

      // Check with path separator boundary to prevent prefix attacks
      if (resolvedTarget === resolvedAllowed ||
          resolvedTarget.startsWith(resolvedAllowed + path.sep)) {
        return { allowed: true };
      }
    } catch {
      // If normalization fails, try direct comparison (Windows paths)
      const resolvedAllowed = path.resolve(allowedPath);
      if (resolvedTarget === resolvedAllowed ||
          resolvedTarget.startsWith(resolvedAllowed + path.sep)) {
        return { allowed: true };
      }
    }
  }

  return {
    allowed: false,
    error: `Path not allowed: ${targetPath}. Configure allowedPaths in config.json.`
  };
}
