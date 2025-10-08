import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ShellConfig } from '../types/config.js';
const execAsync = promisify(exec);

export function extractCommandName(command: string): string {
    // Remove any path components
    const basename = path.basename(command);
    // Remove dangerous extensions (expanded to include script types)
    return basename.replace(/\.(exe|cmd|bat|ps1|vbs|js|com|scr|msi|pif|wsf|hta)$/i, '').toLowerCase();
}

export function isCommandBlocked(command: string, blockedCommands: string[]): boolean {
    const commandName = extractCommandName(command.toLowerCase());
    return blockedCommands.some(blocked => 
        commandName === blocked.toLowerCase() ||
        commandName === `${blocked.toLowerCase()}.exe` ||
        commandName === `${blocked.toLowerCase()}.cmd` ||
        commandName === `${blocked.toLowerCase()}.bat`
    );
}

export function isArgumentBlocked(args: string[], blockedArguments: string[]): boolean {
    return args.some(arg => 
        blockedArguments.some(blocked => 
            new RegExp(`^${blocked}$`, 'i').test(arg)
        )
    );
}

/**
 * Check for dangerous control characters and null bytes
 */
export function containsDangerousCharacters(command: string): boolean {
    // Check for null bytes
    if (command.includes('\x00')) {
        return true;
    }

    // Check for other dangerous control characters (except newline and tab)
    const dangerousControlChars = /[\x01-\x08\x0B-\x0C\x0E-\x1F\x7F]/;
    return dangerousControlChars.test(command);
}

/**
 * Validates a command for a specific shell, checking for shell-specific blocked operators
 */
export function validateShellOperators(command: string, shellConfig: ShellConfig): void {
    // Check for dangerous control characters first
    if (containsDangerousCharacters(command)) {
        throw new Error('Command contains dangerous control characters');
    }

    // Skip validation if shell doesn't specify blocked operators
    if (!shellConfig.blockedOperators?.length) {
        return;
    }

    // Enhanced operator blocking with more comprehensive patterns
    const dangerousOperators = [
        ...shellConfig.blockedOperators,
        // Add common redirection and injection operators
        '>',   // Output redirection
        '<',   // Input redirection
        '>>',  // Append redirection
        '2>',  // Error redirection
        '2>&1' // Combine streams
    ];

    // Check for each operator explicitly (no regex escaping issues)
    for (const op of dangerousOperators) {
        if (command.includes(op)) {
            throw new Error(`Command contains blocked operator: ${op}`);
        }
    }

    // Check for Unicode variants and homoglyphs of common operators
    const unicodeVariants = {
        '|': [
            '｜', '\uFF5C',  // Fullwidth vertical line
            '│', '\u2502',  // Box drawings light vertical
            '⏐', '\u23D0',  // Vertical line extension
            '∣', '\u2223',  // Divides
            'ǀ', '\u01C0',  // Latin letter dental click
        ],
        ';': [
            '；', '\uFF1B',  // Fullwidth semicolon
            '᛫', '\u16EB',  // Runic single punctuation
            '︔', '\uFE14',  // Presentation form vertical semicolon
        ],
        '&': [
            '＆', '\uFF06',  // Fullwidth ampersand
            '﹠', '\uFE60',  // Small ampersand
        ],
        '>': [
            '＞', '\uFF1E',  // Fullwidth greater-than
            '›', '\u203A',  // Single right-pointing angle quotation mark
            '❯', '\u276F',  // Heavy right-pointing angle quotation mark
        ],
        '<': [
            '＜', '\uFF1C',  // Fullwidth less-than
            '‹', '\u2039',  // Single left-pointing angle quotation mark
            '❮', '\u276E',  // Heavy left-pointing angle quotation mark
        ],
    };

    for (const [ascii, variants] of Object.entries(unicodeVariants)) {
        for (const variant of variants) {
            if (command.includes(variant)) {
                throw new Error(`Command contains Unicode variant of blocked operator: ${ascii}`);
            }
        }
    }

    // Check for zero-width characters that could be used to split operators
    const zeroWidthChars = [
        '\u200B',  // Zero-width space
        '\u200C',  // Zero-width non-joiner
        '\u200D',  // Zero-width joiner
        '\uFEFF',  // Zero-width no-break space
    ];

    for (const char of zeroWidthChars) {
        if (command.includes(char)) {
            throw new Error('Command contains zero-width characters');
        }
    }
}

/**
 * Parse a command string into command and arguments, properly handling paths with spaces and quotes
 */
export function parseCommand(fullCommand: string): { command: string; args: string[] } {
    fullCommand = fullCommand.trim();
    if (!fullCommand) {
        return { command: '', args: [] };
    }

    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    // Parse into tokens, preserving quoted strings and handling escapes
    for (let i = 0; i < fullCommand.length; i++) {
        const char = fullCommand[i];

        // Handle escape sequences (backslash)
        if (char === '\\' && i + 1 < fullCommand.length) {
            const nextChar = fullCommand[i + 1];
            // Escape quotes, backslashes, and certain special chars
            if (nextChar === '"' || nextChar === "'" || nextChar === '\\') {
                current += nextChar;
                i++; // Skip the next character
                continue;
            }
        }

        // Handle quotes
        if ((char === '"' || char === "'") && (!inQuotes || char === quoteChar)) {
            if (inQuotes) {
                tokens.push(current);
                current = '';
            }
            inQuotes = !inQuotes;
            quoteChar = inQuotes ? char : '';
            continue;
        }

        // Handle spaces outside quotes
        if (char === ' ' && !inQuotes) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }

    // Check for unclosed quotes - this is a security issue
    if (inQuotes) {
        throw new Error(`Unclosed ${quoteChar} quote in command`);
    }

    // Add any remaining token
    if (current) {
        tokens.push(current);
    }

    // Handle empty input
    if (tokens.length === 0) {
        return { command: '', args: [] };
    }

    // First, check if this is a single-token command
    if (!tokens[0].includes(' ') && !tokens[0].includes('\\')) {
        return {
            command: tokens[0],
            args: tokens.slice(1)
        };
    }

    // Special handling for Windows paths with spaces
    let commandTokens: string[] = [];
    let i = 0;

    // Keep processing tokens until we find a complete command path
    while (i < tokens.length) {
        commandTokens.push(tokens[i]);
        const potentialCommand = commandTokens.join(' ');

        // Check if this could be a complete command path
        if (/\.(exe|cmd|bat)$/i.test(potentialCommand) || 
            (!potentialCommand.includes('\\') && commandTokens.length === 1)) {
            return {
                command: potentialCommand,
                args: tokens.slice(i + 1)
            };
        }

        // If this is part of a path, keep looking
        if (potentialCommand.includes('\\')) {
            i++;
            continue;
        }

        // If we get here, treat the first token as the command
        return {
            command: tokens[0],
            args: tokens.slice(1)
        };
    }

    // If we get here, use all collected tokens as the command
    return {
        command: commandTokens.join(' '),
        args: tokens.slice(commandTokens.length)
    };
}

/**
 * Safely canonicalize a path, resolving symlinks, junctions, and handling errors
 */
export function canonicalizePath(inputPath: string): string {
    try {
        // Use realpathSync to resolve all symbolic links, junctions, and relative paths
        const realPath = require('fs').realpathSync(inputPath, { encoding: 'utf8' });
        return path.normalize(realPath);
    } catch (error) {
        // If path doesn't exist or can't be resolved, normalize it anyway
        // This allows checking against allowed paths even if directory doesn't exist yet
        return path.normalize(path.resolve(inputPath));
    }
}

export function isPathAllowed(testPath: string, allowedPaths: string[]): boolean {
    // Canonicalize the test path to resolve symlinks, junctions, and relative paths
    const canonicalPath = canonicalizePath(testPath).toLowerCase();

    return allowedPaths.some(allowedPath => {
        // Canonicalize each allowed path as well
        const canonicalAllowedPath = canonicalizePath(allowedPath).toLowerCase();

        // Ensure we're checking if the path is truly within the allowed directory
        // Add path separator to prevent partial matches (e.g., C:\test vs C:\test2)
        const normalizedAllowed = canonicalAllowedPath.endsWith(path.sep)
            ? canonicalAllowedPath
            : canonicalAllowedPath + path.sep;

        return canonicalPath === canonicalAllowedPath ||
               canonicalPath.startsWith(normalizedAllowed);
    });
}

export function validateWorkingDirectory(dir: string, allowedPaths: string[]): void {
    if (!path.isAbsolute(dir)) {
        throw new Error('Working directory must be an absolute path');
    }

    if (!isPathAllowed(dir, allowedPaths)) {
        const allowedPathsStr = allowedPaths.join(', ');
        throw new Error(
            `Working directory must be within allowed paths: ${allowedPathsStr}`
        );
    }
}

export function normalizeWindowsPath(inputPath: string): string {
    // Convert forward slashes to backslashes
    let normalized = inputPath.replace(/\//g, '\\');
    
    // Handle Windows drive letter
    if (/^[a-zA-Z]:\\.+/.test(normalized)) {
        // Already in correct form
        return path.normalize(normalized);
    }
    
    // Handle paths without drive letter
    if (normalized.startsWith('\\')) {
        // Assume C: drive if not specified
        normalized = `C:${normalized}`;
    }
    
    return path.normalize(normalized);
}