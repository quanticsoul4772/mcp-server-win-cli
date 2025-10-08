import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import type { ShellConfig } from '../types/config.js';
import { sanitizeConfigPath } from './errorSanitizer.js';
const execAsync = promisify(exec);

/**
 * Interface for enhanced error message options
 */
export interface EnhancedErrorOptions {
  what: string;              // What happened
  why: string;               // Why it's blocked
  howToFix: string[];        // Step-by-step remediation
  warning?: string;          // Security warning (optional)
  tip?: string;              // Additional tip (optional)
  configPath?: string | null; // Path to config file
}

/**
 * Format an enhanced error message with remediation guidance
 */
export function formatEnhancedError(options: EnhancedErrorOptions): string {
  const lines: string[] = [];

  // What happened
  lines.push(options.what);
  lines.push('');

  // Why it's blocked
  lines.push(`WHY: ${options.why}`);
  lines.push('');

  // How to fix
  lines.push('TO FIX:');
  options.howToFix.forEach((step, index) => {
    lines.push(`${index + 1}. ${step}`);
  });
  lines.push('');

  // Security warning if present
  if (options.warning) {
    lines.push(`WARNING: ${options.warning}`);
    lines.push('');
  }

  // Tip if present
  if (options.tip) {
    lines.push(`TIP: ${options.tip}`);
  }

  return lines.join('\n');
}

/**
 * Get the config file location message
 */
export function getConfigLocationMessage(configPath: string | null): string {
  if (configPath) {
    return `Edit your config file: ${sanitizeConfigPath(configPath)}`;
  }

  // Sanitize default locations to avoid exposing usernames
  const homeDir = os.homedir();
  const username = path.basename(homeDir);
  const defaultLocations = [
    'config.json (in current working directory)',
    '~/.win-cli-mcp/config.json (in home directory)'
  ];

  return `Create a config file at one of these locations:\n   - ${defaultLocations.join('\n   - ')}`;
}

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

/**
 * Get the blocked command name for error messages
 */
export function getBlockedCommandName(command: string, blockedCommands: string[]): string | null {
    const commandName = extractCommandName(command.toLowerCase());
    for (const blocked of blockedCommands) {
        if (commandName === blocked.toLowerCase() ||
            commandName === `${blocked.toLowerCase()}.exe` ||
            commandName === `${blocked.toLowerCase()}.cmd` ||
            commandName === `${blocked.toLowerCase()}.bat`) {
            return blocked;
        }
    }
    return null;
}

export function isArgumentBlocked(args: string[], blockedArguments: string[]): boolean {
    return args.some(arg =>
        blockedArguments.some(blocked =>
            new RegExp(`^${blocked}$`, 'i').test(arg)
        )
    );
}

/**
 * Get the specific blocked argument for error messages
 */
export function getBlockedArgument(args: string[], blockedArguments: string[]): string | null {
    for (const arg of args) {
        for (const blocked of blockedArguments) {
            if (new RegExp(`^${blocked}$`, 'i').test(arg)) {
                return arg;
            }
        }
    }
    return null;
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
 * Normalize Unicode text using NFC (Canonical Decomposition, followed by Canonical Composition)
 * This prevents attacks using composed vs decomposed characters
 * @param text - Text to normalize
 * @returns NFC-normalized text
 */
export function normalizeUnicode(text: string): string {
    return text.normalize('NFC');
}

/**
 * Detect PowerShell Unicode quotes that are interpreted as string delimiters
 * Reference: https://blog.stmcyber.com/powershell-unicode-quotes-and-command-injection/
 * @param command - Command to check
 * @returns Object with detected status and character if found
 */
export function detectPowerShellUnicodeQuotes(command: string): { detected: boolean; char?: string; codepoint?: string } {
    const powershellQuotes = new Map([
        ['\u201C', 'U+201C (LEFT DOUBLE QUOTATION MARK)'],    // "
        ['\u201D', 'U+201D (RIGHT DOUBLE QUOTATION MARK)'],   // "
        ['\u2018', 'U+2018 (LEFT SINGLE QUOTATION MARK)'],    // '
        ['\u2019', 'U+2019 (RIGHT SINGLE QUOTATION MARK)'],   // '
        ['\u2033', 'U+2033 (DOUBLE PRIME)'],                  // ″
        ['\u2032', 'U+2032 (PRIME)'],                         // ′
    ]);

    for (const [char, description] of powershellQuotes) {
        if (command.includes(char)) {
            return { detected: true, char, codepoint: description };
        }
    }

    return { detected: false };
}

/**
 * Detect Bidirectional (BiDi) text override control characters
 * These can hide malicious code in logs and source code
 * Reference: CVE-2021-42574 "Trojan Source"
 * @param command - Command to check
 * @returns Object with detected status and character if found
 */
export function detectBidiControlCharacters(command: string): { detected: boolean; char?: string; codepoint?: string } {
    const bidiControls = new Map([
        ['\u202E', 'U+202E (RIGHT-TO-LEFT OVERRIDE - RLO)'],
        ['\u202D', 'U+202D (LEFT-TO-RIGHT OVERRIDE - LRO)'],
        ['\u202A', 'U+202A (LEFT-TO-RIGHT EMBEDDING - LRE)'],
        ['\u202B', 'U+202B (RIGHT-TO-LEFT EMBEDDING - RLE)'],
        ['\u202C', 'U+202C (POP DIRECTIONAL FORMATTING - PDF)'],
        ['\u2066', 'U+2066 (LEFT-TO-RIGHT ISOLATE - LRI)'],
        ['\u2067', 'U+2067 (RIGHT-TO-LEFT ISOLATE - RLI)'],
        ['\u2068', 'U+2068 (FIRST STRONG ISOLATE - FSI)'],
        ['\u2069', 'U+2069 (POP DIRECTIONAL ISOLATE - PDI)'],
    ]);

    for (const [char, description] of bidiControls) {
        if (command.includes(char)) {
            return { detected: true, char, codepoint: description };
        }
    }

    return { detected: false };
}

/**
 * Detect combining characters that could hide operators or commands
 * Reference: UTS #39 Unicode Security Mechanisms
 * @param command - Command to check
 * @returns Object with detected status and position if found
 */
export function detectSuspiciousCombiningCharacters(command: string): { detected: boolean; position?: number; char?: string } {
    // Combining Diacritical Marks (U+0300-U+036F)
    // Combining Marks for Symbols (U+20D0-U+20FF)
    // These can be used to hide or modify the appearance of operators
    const combiningMarksRegex = /[\u0300-\u036F\u20D0-\u20FF]/;

    const match = command.match(combiningMarksRegex);
    if (match && match.index !== undefined) {
        return {
            detected: true,
            position: match.index,
            char: match[0]
        };
    }

    return { detected: false };
}

/**
 * Detect additional invisible or misleading Unicode characters
 * @param command - Command to check
 * @returns Object with detected status and character if found
 */
export function detectInvisibleUnicodeCharacters(command: string): { detected: boolean; char?: string; codepoint?: string } {
    const invisibleChars = new Map([
        // Variation Selectors (can change appearance of preceding character)
        ['\uFE00', 'U+FE00 (VARIATION SELECTOR-1)'],
        ['\uFE01', 'U+FE01 (VARIATION SELECTOR-2)'],
        ['\uFE0E', 'U+FE0E (VARIATION SELECTOR-15 - Text Style)'],
        ['\uFE0F', 'U+FE0F (VARIATION SELECTOR-16 - Emoji Style)'],
        // Other invisible separators
        ['\u2060', 'U+2060 (WORD JOINER)'],
        ['\u2062', 'U+2062 (INVISIBLE TIMES)'],
        ['\u2063', 'U+2063 (INVISIBLE SEPARATOR)'],
        ['\u2064', 'U+2064 (INVISIBLE PLUS)'],
        ['\u206A', 'U+206A (INHIBIT SYMMETRIC SWAPPING)'],
        ['\u206B', 'U+206B (ACTIVATE SYMMETRIC SWAPPING)'],
        ['\u206C', 'U+206C (INHIBIT ARABIC FORM SHAPING)'],
        ['\u206D', 'U+206D (ACTIVATE ARABIC FORM SHAPING)'],
        ['\u206E', 'U+206E (NATIONAL DIGIT SHAPES)'],
        ['\u206F', 'U+206F (NOMINAL DIGIT SHAPES)'],
        // Soft hyphen (often invisible)
        ['\u00AD', 'U+00AD (SOFT HYPHEN)'],
    ]);

    for (const [char, description] of invisibleChars) {
        if (command.includes(char)) {
            return { detected: true, char, codepoint: description };
        }
    }

    return { detected: false };
}

/**
 * Validates a command for a specific shell, checking for shell-specific blocked operators
 */
export function validateShellOperators(command: string, shellConfig: ShellConfig, configPath: string | null = null): void {
    // STEP 1: Normalize Unicode to NFC form to prevent composed/decomposed character attacks
    const normalizedCommand = normalizeUnicode(command);

    // STEP 2: Check for PowerShell Unicode quotes (CVE-like vulnerability)
    const unicodeQuoteCheck = detectPowerShellUnicodeQuotes(normalizedCommand);
    if (unicodeQuoteCheck.detected) {
        throw new Error(formatEnhancedError({
            what: `Command contains PowerShell Unicode quote: ${unicodeQuoteCheck.codepoint}`,
            why: 'PowerShell interprets Unicode quotation marks (U+201C, U+201D, U+2018, U+2019) as string delimiters, allowing command injection attacks. These "smart quotes" are often inserted by word processors.',
            howToFix: [
                `Replace the Unicode quote character '${unicodeQuoteCheck.char}' with a standard ASCII quote (") or (')`,
                'Retype the command manually instead of copying from Word, email, or web pages',
                'Use a plain text editor that doesn\'t auto-convert quotes'
            ],
            warning: 'PowerShell Unicode quote injection is a documented security vulnerability. This protection cannot be disabled.',
            tip: 'Reference: https://blog.stmcyber.com/powershell-unicode-quotes-and-command-injection/',
            configPath
        }));
    }

    // STEP 3: Check for BiDi control characters (CVE-2021-42574 "Trojan Source")
    const bidiCheck = detectBidiControlCharacters(normalizedCommand);
    if (bidiCheck.detected) {
        throw new Error(formatEnhancedError({
            what: `Command contains Bidirectional (BiDi) control character: ${bidiCheck.codepoint}`,
            why: 'BiDi override characters (U+202E, U+202D, etc.) can hide malicious code by reversing the display order of text. This is known as the "Trojan Source" attack (CVE-2021-42574).',
            howToFix: [
                'Remove the BiDi control character from your command',
                'Retype the command manually from a trusted source',
                'Inspect the command using a hex editor to identify hidden control characters'
            ],
            warning: 'BiDi text attacks can make malicious code appear legitimate in logs and source code. This protection cannot be disabled.',
            tip: 'Reference: CVE-2021-42574 - Trojan Source vulnerability',
            configPath
        }));
    }

    // STEP 4: Check for suspicious combining characters
    const combiningCheck = detectSuspiciousCombiningCharacters(normalizedCommand);
    if (combiningCheck.detected) {
        throw new Error(formatEnhancedError({
            what: 'Command contains combining diacritical marks or symbol modifiers',
            why: 'Combining characters can be used to hide or visually modify operators and commands, bypassing security filters.',
            howToFix: [
                'Remove any combining characters from your command',
                'Use only base ASCII characters for operators and commands',
                'Retype the command manually instead of copying from untrusted sources'
            ],
            warning: 'Combining character attacks can make malicious operators appear as innocent text.',
            tip: 'Reference: UTS #39 Unicode Security Mechanisms',
            configPath
        }));
    }

    // STEP 5: Check for additional invisible Unicode characters
    const invisibleCheck = detectInvisibleUnicodeCharacters(normalizedCommand);
    if (invisibleCheck.detected) {
        throw new Error(formatEnhancedError({
            what: `Command contains invisible Unicode character: ${invisibleCheck.codepoint}`,
            why: 'Invisible characters like variation selectors, word joiners, and formatting controls can be used to bypass security filters or hide malicious content.',
            howToFix: [
                `Remove the invisible character '${invisibleCheck.char}' from your command`,
                'Retype the command manually instead of copying',
                'Use a text editor with "show invisible characters" enabled to identify them'
            ],
            warning: 'Invisible Unicode characters are a common stealth attack vector.',
            configPath
        }));
    }

    // STEP 6: Check for dangerous control characters
    if (containsDangerousCharacters(normalizedCommand)) {
        throw new Error(formatEnhancedError({
            what: 'Command contains dangerous control characters.',
            why: 'Control characters (null bytes, non-printable characters) can be used to bypass security checks or inject malicious commands.',
            howToFix: [
                'Remove any non-printable characters from your command',
                'Ensure your command uses only standard ASCII characters',
                'If you copied this command from somewhere, try retyping it manually'
            ],
            warning: 'Control character injection is a serious security risk. This check cannot be disabled.',
            configPath
        }));
    }

    // Skip validation if shell doesn't specify blocked operators
    if (!shellConfig.blockedOperators?.length) {
        return;
    }

    // STEP 7: Enhanced operator blocking with more comprehensive patterns
    const dangerousOperators = [
        ...shellConfig.blockedOperators,
        // Add common redirection and injection operators (order matters - check longest first!)
        '2>&1', // Combine streams
        '>>',  // Append redirection
        '2>',  // Error redirection
        '>',   // Output redirection
        '<',   // Input redirection
    ];

    // Check for each operator explicitly (no regex escaping issues)
    // Order matters: check longest operators first to avoid false positives
    for (const op of dangerousOperators) {
        if (normalizedCommand.includes(op)) {
            const configLocationMsg = getConfigLocationMessage(configPath);
            throw new Error(formatEnhancedError({
                what: `Command contains blocked operator: '${op}'`,
                why: 'Shell operators like |, &, ;, >, < can be used to chain commands, redirect output, or execute multiple commands. This is blocked to prevent command injection attacks.',
                howToFix: [
                    configLocationMsg,
                    `Remove '${op}' from the "shells.{shellName}.blockedOperators" array`,
                    'Restart the MCP server'
                ],
                warning: `Allowing '${op}' enables command chaining and could allow malicious code execution. Only allow if you trust all command sources.`,
                tip: 'Use the check_security_config tool to view all blocked operators for each shell.',
                configPath
            }));
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

    // STEP 8: Check for Unicode variants and homoglyphs of operators
    for (const [ascii, variants] of Object.entries(unicodeVariants)) {
        for (const variant of variants) {
            if (normalizedCommand.includes(variant)) {
                throw new Error(formatEnhancedError({
                    what: `Command contains Unicode variant of blocked operator: '${ascii}' (detected: '${variant}')`,
                    why: 'Attackers use Unicode lookalike characters (homoglyphs) to bypass security filters. These characters appear like normal operators but use different Unicode codepoints.',
                    howToFix: [
                        `Replace the Unicode character '${variant}' with the standard ASCII operator '${ascii}'`,
                        'If this is a legitimate use case (e.g., displaying Unicode in output), consider using escape sequences or a different approach',
                        'Retype the command manually instead of copying from untrusted sources'
                    ],
                    warning: 'Unicode homoglyph attacks are a known security vector. This protection cannot be disabled.',
                    tip: 'If you copied this command from a document or web page, Unicode characters may have been substituted.',
                    configPath
                }));
            }
        }
    }

    // STEP 9: Check for zero-width characters that could be used to split operators
    const zeroWidthChars = [
        '\u200B',  // Zero-width space
        '\u200C',  // Zero-width non-joiner
        '\u200D',  // Zero-width joiner
        '\uFEFF',  // Zero-width no-break space
    ];

    for (const char of zeroWidthChars) {
        if (normalizedCommand.includes(char)) {
            throw new Error(formatEnhancedError({
                what: 'Command contains zero-width characters.',
                why: 'Zero-width characters are invisible but can be used to bypass security filters by splitting operators or commands. They are commonly inserted by malicious scripts.',
                howToFix: [
                    'Retype your command manually instead of copying it',
                    'Use a text editor that shows invisible characters to identify and remove them',
                    'If the command came from an untrusted source, verify its authenticity'
                ],
                warning: 'Zero-width character injection is a stealth attack vector. This protection cannot be disabled.',
                tip: 'These characters are often invisible in normal text editors. Consider using a hex editor or developer tools to inspect your command.',
                configPath
            }));
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

    // Handle UNC paths (\\server\share)
    if (normalized.startsWith('\\\\')) {
        // UNC path - preserve as-is and normalize
        return path.normalize(normalized);
    }

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
