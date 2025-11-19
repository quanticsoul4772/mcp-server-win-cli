# Implementation Plan: Environment Variable & UTF-8 Encoding Support

## Executive Summary

Add support for custom environment variables and UTF-8 encoding configuration to the windows-cli MCP server to resolve Unicode display issues and enable better control over command execution environments.

**Primary Use Case:** Enable proper Unicode rendering for tools like spec-kit's `specify` CLI which displays Unicode banners.

**Status:** ✅ **COMPLETED** - Implemented on 2025-05-19

**Original Timeline:** 2-3 days for implementation and testing

---

## Implementation Summary

All phases completed successfully:
- ✅ Phase 1: Core infrastructure (EnvironmentManager, SecurityManager, ConfigManager, types)
- ✅ Phase 2: Tool updates (ExecuteCommandTool, BatchTool, BackgroundJobTool, SSHExecuteTool)
- ✅ Phase 3: Diagnostics (CheckSecurityConfigTool with 'environment' category)
- ✅ Phase 4: Tests (49 new test cases, 537 total tests passing)
- ✅ Documentation updates (README, CLAUDE.md)

**Key Features Implemented:**
- `env` parameter on execute_command, execute_batch, start_background_job, ssh_execute
- Blocklist/allowlist security modes for environment variables
- Shell-specific `defaultEnv` configuration
- Config-time validation for defaultEnv
- Value validation (null bytes, length, control characters)

---

## Problem Statement

### Current Limitations

1. **No Environment Variable Control**
   - Cannot set `PYTHONIOENCODING=utf-8` for Python processes
   - Cannot set `PYTHONUTF8=1` for Python 3.7+
   - Cannot configure shell-specific environment variables
   - Cannot override system PATH or other variables per-command

2. **Unicode/Encoding Issues**
   - Windows default encoding (cp1252) fails with Unicode characters
   - Python tools with Unicode output (like spec-kit) crash with `UnicodeEncodeError`
   - No way to force UTF-8 mode without modifying system settings

3. **Limited Command Context Control**
   - Cannot set working directory-specific environment
   - Cannot inject credentials or API keys securely for specific commands
   - No per-shell environment customization

### Impact

- Python CLI tools with Unicode fail (spec-kit, others with rich terminal UI)
- International character support broken
- Cannot use modern terminal-aware applications effectively
- Workarounds require manual environment setup or script wrappers

---

## Research Findings

### Node.js child_process Environment Variables

From Node.js documentation and community research:

```typescript
// Current pattern
spawn(command, args, {
  cwd: workingDir,
  stdio: ['pipe', 'pipe', 'pipe']
})

// With environment variables
spawn(command, args, {
  cwd: workingDir,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,        // Inherit parent environment
    CUSTOM_VAR: 'value',   // Add/override specific variables
    PYTHONIOENCODING: 'utf-8'
  }
})
```

**Key Findings:**
- `env` option completely replaces process.env if not spread
- Must explicitly spread `...process.env` to inherit system environment
- Environment variables are case-sensitive on Unix, case-insensitive on Windows
- Empty env object `{}` creates isolated environment (no PATH, etc.)

### Python UTF-8 Encoding on Windows

**Python 3.7+ (Recommended):**
- `PYTHONUTF8=1` - Enables UTF-8 mode globally
- Forces UTF-8 for stdin/stdout/stderr regardless of console code page
- More robust than PYTHONIOENCODING

**Python 3.6 and below:**
- `PYTHONIOENCODING=utf-8` - Sets I/O encoding
- May still have issues with Windows console API

**Windows Console Behavior:**
- `chcp 65001` sets console to UTF-8 but doesn't affect Python
- Python detects console encoding at startup
- Environment variables must be set BEFORE Python process starts

### Security Considerations

From SecurityManager patterns in codebase:
- Environment variables can contain sensitive data (API keys, passwords, tokens)
- Must validate variable names against blocklist
- Should sanitize values in logs and error messages
- Need allowlist/blocklist security controls

---

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  ExecuteCommandTool (existing)                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Input Schema (new parameter):                    │  │
│  │    env?: Record<string, string>                   │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  SecurityManager (new validation):                │  │
│  │    - validateEnvironmentVariables()               │  │
│  │    - Check against blockedEnvVars                 │  │
│  │    - Apply allowlist if configured                │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  EnvironmentManager (extended):                   │  │
│  │    - mergeEnvironmentVariables()                  │  │
│  │    - Merge system + shell defaults + user vars    │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  CommandExecutor (modified):                      │  │
│  │    spawn(cmd, args, {                             │  │
│  │      cwd: workingDir,                             │  │
│  │      env: mergedEnv  // NEW                       │  │
│  │    })                                             │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Feature 1: Per-Command Environment Variables

#### API Changes

**ExecuteCommandTool** - Add optional `env` parameter:

```typescript
interface ExecuteCommandArgs {
  shell: keyof ServerConfig['shells'];
  command: string;
  workingDir?: string;
  timeout?: number;
  env?: Record<string, string>;  // NEW
}
```

**Example Usage:**

```json
{
  "tool": "execute_command",
  "arguments": {
    "shell": "powershell",
    "command": "python -c \"print('Hello 世界')\"",
    "env": {
      "PYTHONIOENCODING": "utf-8",
      "PYTHONUTF8": "1"
    }
  }
}
```

#### Configuration Schema

**Add to SecurityConfig:**

```typescript
export interface SecurityConfig {
  // ... existing fields ...
  
  /**
   * Environment variables blocked from being set (security)
   * Prevents credential leakage and privilege escalation
   */
  blockedEnvVars?: string[];
  
  /**
   * If set, ONLY these environment variables can be modified
   * If undefined, blocklist mode is used
   */
  allowedEnvVars?: string[];
  
  /**
   * Maximum number of custom environment variables per command
   */
  maxCustomEnvVars?: number;
}
```

**Default Configuration:**

```json
{
  "security": {
    "blockedEnvVars": [
      "AWS_SECRET_ACCESS_KEY",
      "AWS_ACCESS_KEY_ID",
      "AZURE_CLIENT_SECRET",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GITHUB_TOKEN",
      "PASSWORD",
      "TOKEN",
      "SECRET",
      "API_KEY",
      "PATH",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "DYLD_INSERT_LIBRARIES",
      "DYLD_LIBRARY_PATH"
    ],
    "maxCustomEnvVars": 20,
    "maxEnvVarValueLength": 32768
  }
}
```

**Configuration Merge Strategy:**

The new environment variable configuration arrays follow fail-secure merge rules consistent with existing patterns:

- **blockedEnvVars**: Uses **UNION** merge (combines default + user blocks)
  - More restrictive = more items blocked
  - Example: Default blocks "PASSWORD", user adds "MY_SECRET" → Both blocked

- **allowedEnvVars**: Uses **INTERSECTION** merge (only common items allowed)
  - Prevents weakening security by adding overly broad allowlists
  - Example: Default allows ["A", "B"], user specifies ["B", "C"] → Only "B" allowed

- **maxCustomEnvVars**: Uses **MIN** (most restrictive value wins)
- **maxEnvVarValueLength**: Uses **MIN** (most restrictive value wins)

### Feature 2: Shell-Specific Default Environment Variables

**Add to ShellConfig:**

```typescript
export interface ShellConfig {
  enabled: boolean;
  command: string;
  args: string[];
  validatePath?: (dir: string) => boolean;
  blockedOperators?: string[];
  defaultEnv?: Record<string, string>;  // NEW
}
```

**Example Configuration:**

```json
{
  "shells": {
    "powershell": {
      "enabled": true,
      "command": "powershell.exe",
      "args": ["-NoProfile", "-NonInteractive", "-Command"],
      "blockedOperators": ["&", "|", ";", "`"],
      "defaultEnv": {
        "PSModulePath": "C:\\CustomModules;$env:PSModulePath",
        "PYTHONIOENCODING": "utf-8"
      }
    }
  }
}
```

### Feature 3: Environment Variable Presets

**Add to config.json:**

```json
{
  "environmentPresets": {
    "python-utf8": {
      "PYTHONIOENCODING": "utf-8",
      "PYTHONUTF8": "1",
      "PYTHONLEGACYWINDOWSSTDIO": "0"
    },
    "nodejs-utf8": {
      "NODE_OPTIONS": "--input-type=module"
    },
    "dev-mode": {
      "DEBUG": "*",
      "NODE_ENV": "development"
    }
  }
}
```

**Usage:**

```json
{
  "tool": "execute_command",
  "arguments": {
    "shell": "powershell",
    "command": "python script.py",
    "envPreset": "python-utf8"
  }
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Day 1)

#### Task 1.1: Extend EnvironmentManager

**File:** `src/services/EnvironmentManager.ts`

**New Methods:**

```typescript
/**
 * Validate environment variable names for security
 * @throws Error if variable is blocked or not allowed
 */
public validateEnvVarName(name: string): void {
  const upperName = name.toUpperCase();
  
  // Allowlist mode
  if (this.allowedEnvVars) {
    if (!this.allowedEnvVars.has(upperName)) {
      throw new Error(`Environment variable "${name}" is not in allowlist`);
    }
    return;
  }
  
  // Blocklist mode
  if (this.blockedEnvVars.has(upperName)) {
    throw new Error(`Environment variable "${name}" is blocked for security`);
  }
  
  // Check patterns
  for (const blocked of this.blockedEnvVars) {
    if (upperName.includes(blocked)) {
      throw new Error(`Environment variable "${name}" matches blocked pattern "${blocked}"`);
    }
  }
}

/**
 * Validate multiple environment variables (names and values)
 * @throws Error if any variable fails validation or count exceeds limit
 */
public validateEnvVars(
  vars: Record<string, string>,
  maxCount: number = 20,
  maxValueLength: number = 32768
): void {
  const keys = Object.keys(vars);

  if (keys.length > maxCount) {
    throw new Error(
      `Too many environment variables (${keys.length}). Maximum: ${maxCount}`
    );
  }

  for (const key of keys) {
    this.validateEnvVarName(key);
    this.validateEnvVarValue(key, vars[key], maxValueLength);
  }
}

/**
 * Validate environment variable value for security and sanity
 * @throws Error if value is invalid
 */
public validateEnvVarValue(
  name: string,
  value: string,
  maxLength: number = 32768
): void {
  // Check for null bytes (can cause issues with C-based programs)
  if (value.includes('\0')) {
    throw new Error(
      `Environment variable "${name}" value contains null bytes which are not allowed`
    );
  }

  // Check length
  if (value.length > maxLength) {
    throw new Error(
      `Environment variable "${name}" value exceeds maximum length ` +
      `(${value.length} > ${maxLength})`
    );
  }

  // Check for other dangerous control characters (except newline and tab)
  const dangerousChars = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
  if (dangerousChars.test(value)) {
    throw new Error(
      `Environment variable "${name}" value contains dangerous control characters`
    );
  }
}

/**
 * Merge environment variables with proper precedence
 * Order: system env < shell defaults < user overrides
 */
public mergeEnvironmentVariables(
  shellDefaults?: Record<string, string>,
  userOverrides?: Record<string, string>
): Record<string, string> {
  return {
    ...process.env,
    ...(shellDefaults || {}),
    ...(userOverrides || {})
  };
}
```

**Tests:** `__tests__/services/EnvironmentManager.test.ts`

```typescript
describe('EnvironmentManager - Environment Variable Management', () => {
  test('should validate allowed environment variables', () => {
    const envMgr = new EnvironmentManager(mockConfig);
    expect(() => envMgr.validateEnvVarName('MY_VAR')).not.toThrow();
  });

  test('should block sensitive environment variables', () => {
    const envMgr = new EnvironmentManager(mockConfig);
    expect(() => envMgr.validateEnvVarName('AWS_SECRET_ACCESS_KEY'))
      .toThrow(/blocked for security/);
  });

  test('should enforce max environment variable count', () => {
    const envMgr = new EnvironmentManager(mockConfig);
    const tooMany = Array.from({ length: 25 }, (_, i) => [`VAR${i}`, 'value']);
    expect(() => envMgr.validateEnvVars(Object.fromEntries(tooMany), 20))
      .toThrow(/Too many environment variables/);
  });

  test('should merge environment variables with correct precedence', () => {
    const envMgr = new EnvironmentManager(mockConfig);
    const merged = envMgr.mergeEnvironmentVariables(
      { VAR1: 'shell', VAR2: 'shell' },
      { VAR2: 'user', VAR3: 'user' }
    );

    expect(merged.VAR1).toBe('shell');
    expect(merged.VAR2).toBe('user');  // User overrides shell
    expect(merged.VAR3).toBe('user');
  });

  test('should reject values with null bytes', () => {
    const envMgr = new EnvironmentManager(mockConfig);
    expect(() => envMgr.validateEnvVars({ BAD: 'value\0null' }, 20))
      .toThrow(/null bytes/);
  });

  test('should reject values exceeding max length', () => {
    const envMgr = new EnvironmentManager(mockConfig);
    const longValue = 'x'.repeat(50000);
    expect(() => envMgr.validateEnvVars({ LONG: longValue }, 20, 32768))
      .toThrow(/exceeds maximum length/);
  });

  test('should reject values with dangerous control characters', () => {
    const envMgr = new EnvironmentManager(mockConfig);
    expect(() => envMgr.validateEnvVars({ BAD: 'value\x07bell' }, 20))
      .toThrow(/dangerous control characters/);
  });

  test('should allow values with newlines and tabs', () => {
    const envMgr = new EnvironmentManager(mockConfig);
    expect(() => envMgr.validateEnvVars({ MULTILINE: 'line1\nline2\ttab' }, 20))
      .not.toThrow();
  });
});
```

#### Task 1.2: Update SecurityManager

**File:** `src/services/SecurityManager.ts`

**New Method:**

```typescript
/**
 * Validate environment variables against security policy
 * Stage 6 of validation pipeline
 */
public validateEnvironmentVariables(
  envVars: Record<string, string> | undefined,
  shell: keyof ServerConfig['shells']
): void {
  if (!envVars || Object.keys(envVars).length === 0) {
    return; // No custom env vars, skip validation
  }

  const envManager = this.getEnvironmentManager();
  const maxCount = this.config.security.maxCustomEnvVars || 20;

  try {
    envManager.validateEnvVars(envVars, maxCount);
  } catch (error) {
    throw new Error(
      `Environment variable validation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

**Update validateCommand method:**

```typescript
public validateCommand(
  shell: keyof ServerConfig['shells'],
  command: string,
  workingDir?: string,
  envVars?: Record<string, string>  // NEW
): void {
  // ... existing stages 1-5 ...
  
  // Stage 6: Validate environment variables (NEW)
  this.validateEnvironmentVariables(envVars, shell);
}
```

**Tests:** `__tests__/services/SecurityManager.test.ts`

#### Task 1.3: Update Config Types

**File:** `src/types/config.ts`

Add new fields to interfaces as shown in "Configuration Schema" section above.

#### Task 1.4: Update ConfigManager

**File:** `src/services/ConfigManager.ts`

Update schema validation to include new optional fields:
- `security.blockedEnvVars`
- `security.allowedEnvVars`
- `security.maxCustomEnvVars`
- `security.maxEnvVarValueLength`
- `shells[].defaultEnv`

**Add Config-Time Validation for defaultEnv Conflicts:**

Validate that shell `defaultEnv` values don't conflict with `blockedEnvVars` at configuration load time, not execution time. This prevents silent failures and provides clear error messages.

```typescript
/**
 * Validate that shell defaultEnv doesn't contain blocked environment variables
 * @throws Error if any defaultEnv contains blocked variables
 */
private validateDefaultEnvAgainstBlocklist(config: ServerConfig): void {
  const blockedEnvVars = new Set(
    (config.security.blockedEnvVars || []).map(v => v.toUpperCase())
  );

  for (const [shellName, shellConfig] of Object.entries(config.shells)) {
    if (!shellConfig.defaultEnv) continue;

    for (const envVarName of Object.keys(shellConfig.defaultEnv)) {
      const upperName = envVarName.toUpperCase();

      // Check exact match
      if (blockedEnvVars.has(upperName)) {
        throw new Error(
          `Configuration error: Shell "${shellName}" defaultEnv contains blocked ` +
          `environment variable "${envVarName}". Remove it from defaultEnv or ` +
          `remove "${envVarName}" from security.blockedEnvVars.`
        );
      }

      // Check pattern match
      for (const blocked of blockedEnvVars) {
        if (upperName.includes(blocked)) {
          throw new Error(
            `Configuration error: Shell "${shellName}" defaultEnv variable ` +
            `"${envVarName}" matches blocked pattern "${blocked}". ` +
            `Remove it from defaultEnv or update security.blockedEnvVars.`
          );
        }
      }
    }
  }
}

/**
 * Validate defaultEnv values against maxEnvVarValueLength
 */
private validateDefaultEnvValueLengths(config: ServerConfig): void {
  const maxLength = config.security.maxEnvVarValueLength || 32768;

  for (const [shellName, shellConfig] of Object.entries(config.shells)) {
    if (!shellConfig.defaultEnv) continue;

    for (const [key, value] of Object.entries(shellConfig.defaultEnv)) {
      if (value.length > maxLength) {
        throw new Error(
          `Configuration error: Shell "${shellName}" defaultEnv variable ` +
          `"${key}" value exceeds maximum length (${value.length} > ${maxLength}).`
        );
      }

      // Check for null bytes
      if (value.includes('\0')) {
        throw new Error(
          `Configuration error: Shell "${shellName}" defaultEnv variable ` +
          `"${key}" contains null bytes which are not allowed.`
        );
      }
    }
  }
}
```

**Update loadConfig() to call validators:**

```typescript
public loadConfig(configPath?: string): ServerConfig {
  // ... existing config loading logic ...

  // Validate defaultEnv against blocklist (NEW)
  this.validateDefaultEnvAgainstBlocklist(config);

  // Validate defaultEnv value lengths (NEW)
  this.validateDefaultEnvValueLengths(config);

  return config;
}
```

**Tests:** `__tests__/services/ConfigManager.test.ts`

```typescript
describe('ConfigManager - Environment Variable Validation', () => {
  test('should reject defaultEnv containing blocked variables', () => {
    const invalidConfig = {
      shells: {
        powershell: {
          enabled: true,
          command: 'powershell.exe',
          args: ['-Command'],
          defaultEnv: {
            AWS_SECRET_ACCESS_KEY: 'should-fail'
          }
        }
      },
      security: {
        blockedEnvVars: ['AWS_SECRET_ACCESS_KEY']
      }
    };

    expect(() => new ConfigManager(invalidConfig))
      .toThrow(/blocked environment variable/);
  });

  test('should reject defaultEnv matching blocked patterns', () => {
    const invalidConfig = {
      shells: {
        powershell: {
          enabled: true,
          command: 'powershell.exe',
          args: ['-Command'],
          defaultEnv: {
            MY_PASSWORD_VAR: 'should-fail'
          }
        }
      },
      security: {
        blockedEnvVars: ['PASSWORD']
      }
    };

    expect(() => new ConfigManager(invalidConfig))
      .toThrow(/matches blocked pattern/);
  });

  test('should reject defaultEnv with values exceeding max length', () => {
    const longValue = 'x'.repeat(50000);
    const invalidConfig = {
      shells: {
        powershell: {
          enabled: true,
          command: 'powershell.exe',
          args: ['-Command'],
          defaultEnv: {
            LONG_VAR: longValue
          }
        }
      },
      security: {
        maxEnvVarValueLength: 32768
      }
    };

    expect(() => new ConfigManager(invalidConfig))
      .toThrow(/exceeds maximum length/);
  });

  test('should reject defaultEnv with null bytes in values', () => {
    const invalidConfig = {
      shells: {
        powershell: {
          enabled: true,
          command: 'powershell.exe',
          args: ['-Command'],
          defaultEnv: {
            BAD_VAR: 'value\0with\0nulls'
          }
        }
      }
    };

    expect(() => new ConfigManager(invalidConfig))
      .toThrow(/contains null bytes/);
  });

  test('should accept valid defaultEnv configuration', () => {
    const validConfig = {
      shells: {
        powershell: {
          enabled: true,
          command: 'powershell.exe',
          args: ['-Command'],
          defaultEnv: {
            PYTHONIOENCODING: 'utf-8',
            NODE_ENV: 'development'
          }
        }
      },
      security: {
        blockedEnvVars: ['PASSWORD', 'SECRET']
      }
    };

    expect(() => new ConfigManager(validConfig)).not.toThrow();
  });
});
```

### Phase 2: Command Execution Integration (Day 2)

#### Task 2.1: Update CommandExecutor

**File:** `src/services/CommandExecutor.ts`

**Update Interface:**

```typescript
export interface CommandExecutionOptions {
  shell: keyof ServerConfig['shells'];
  command: string;
  workingDir?: string;
  timeout?: number;
  env?: Record<string, string>;  // NEW
}
```

**Update execute() method:**

```typescript
async execute(options: CommandExecutionOptions): Promise<CommandExecutionResult> {
  const { shell, command, workingDir: userWorkingDir, timeout, env: userEnv } = options;

  // Validate working directory
  const workingDir = await this.validateWorkingDirectory(userWorkingDir, userWorkingDir);

  const shellConfig = this.config.shells[shell];
  const timeoutSeconds = timeout || this.config.security.commandTimeout;

  // NEW: Merge environment variables
  const envManager = new EnvironmentManager(
    this.configManager,
    this.config.security.blockedEnvVars,
    this.config.security.allowedEnvVars
  );

  const mergedEnv = envManager.mergeEnvironmentVariables(
    shellConfig.defaultEnv,
    userEnv
  );

  return new Promise((resolve, reject) => {
    let shellProcess: ReturnType<typeof spawn>;

    try {
      shellProcess = spawn(
        shellConfig.command,
        [...shellConfig.args, command],
        {
          cwd: workingDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: mergedEnv  // NEW
        }
      );
    } catch (err) {
      reject(new Error(
        `Failed to start shell process: ${createUserFriendlyError(err)}`
      ));
      return;
    }

    // ... rest of existing implementation ...
  });
}
```

**Tests:** `__tests__/services/CommandExecutor.test.ts`

```typescript
describe('CommandExecutor - Environment Variables', () => {
  test('should pass custom environment variables to spawned process', async () => {
    const result = await executor.execute({
      shell: 'powershell',
      command: '$env:CUSTOM_VAR',
      env: { CUSTOM_VAR: 'test-value' }
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('test-value');
  });

  test('should merge shell defaults with custom env vars', async () => {
    // Configure shell with defaultEnv
    const customConfig = {
      ...mockConfig,
      shells: {
        ...mockConfig.shells,
        powershell: {
          ...mockConfig.shells.powershell,
          defaultEnv: { DEFAULT_VAR: 'shell-default' }
        }
      }
    };

    const customExecutor = new CommandExecutor(
      customConfig,
      customConfig.security.allowedPaths,
      null
    );

    const result = await customExecutor.execute({
      shell: 'powershell',
      command: '$env:DEFAULT_VAR',
      env: { CUSTOM_VAR: 'user-value' }
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('shell-default');
  });

  test('should allow user env vars to override shell defaults', async () => {
    const customConfig = {
      ...mockConfig,
      shells: {
        ...mockConfig.shells,
        powershell: {
          ...mockConfig.shells.powershell,
          defaultEnv: { MY_VAR: 'shell-value' }
        }
      }
    };

    const customExecutor = new CommandExecutor(
      customConfig,
      customConfig.security.allowedPaths,
      null
    );

    const result = await customExecutor.execute({
      shell: 'powershell',
      command: '$env:MY_VAR',
      env: { MY_VAR: 'user-override' }
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('user-override');
  });

  test('should handle Python UTF-8 encoding with PYTHONIOENCODING', async () => {
    const result = await executor.execute({
      shell: 'powershell',
      command: 'python -c "print(\'Hello 世界\')"',
      env: {
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('世界');
  }, 10000);
});
```

#### Task 2.2: Update ExecuteCommandTool

**File:** `src/tools/command/ExecuteCommandTool.ts`

**Update getInputSchema():**

```typescript
getInputSchema() {
  const configManager = this.getService<ConfigManager>('ConfigManager');
  const enabledShells = configManager.getEnabledShells();

  return {
    type: 'object',
    properties: {
      shell: {
        type: 'string',
        enum: enabledShells,
        description: 'Shell to use for command execution'
      },
      command: {
        type: 'string',
        description: 'Command to execute'
      },
      workingDir: {
        type: 'string',
        description: 'Working directory for command execution (optional)'
      },
      timeout: {
        type: 'number',
        description: 'Command timeout in seconds (overrides config default)'
      },
      env: {  // NEW
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Custom environment variables for command execution (optional)'
      }
    },
    required: ['shell', 'command']
  };
}
```

**Update execute() method:**

```typescript
async execute(args: ExecuteCommandArgs): Promise<ToolResult> {
  const { shell, command, workingDir, timeout, env } = args;  // NEW: destructure env

  const securityManager = this.getService<SecurityManager>('SecurityManager');
  const commandExecutor = this.getService<CommandExecutor>('CommandExecutor');
  const historyManager = this.getService<HistoryManager>('HistoryManager');

  try {
    // Multi-stage validation (now includes env var validation)
    securityManager.validateCommand(shell, command, workingDir, env);  // NEW: pass env

    // Execute command with environment variables
    const result = await commandExecutor.execute({
      shell,
      command,
      workingDir,
      timeout,
      env  // NEW
    });

    // ... rest of existing implementation ...
  } catch (error) {
    // ... existing error handling ...
    
    // NEW: Add error case for environment variable validation
    if (errorMessage.includes('Environment variable')) {
      structured = this.createStructuredError(
        'env_var_blocked',
        'SEC005',
        {
          command: command,
          shell: shell,
          error: errorMessage
        },
        'Environment variable is blocked by security policy. Review blockedEnvVars in config.json or use check_security_config tool.',
        'check_security_config',
        { category: 'all' }
      );
    }

    // ... existing error return ...
  }
}
```

**Update description in constructor:**

```typescript
super(
  container,
  'execute_command',
  `[Command Execution] Execute a command in the specified shell (powershell, cmd, or gitbash)

Example usage (PowerShell):
\`\`\`json
{
  "shell": "powershell",
  "command": "Get-Process | Select-Object -First 5",
  "workingDir": "C:\\\\Users\\\\username"
}
\`\`\`

Example usage with custom environment variables:
\`\`\`json
{
  "shell": "powershell",
  "command": "python -c \\"print('Hello 世界')\\"",
  "env": {
    "PYTHONIOENCODING": "utf-8",
    "PYTHONUTF8": "1"
  }
}
\`\`\`

Example usage (CMD):
\`\`\`json
{
  "shell": "cmd",
  "command": "dir /b",
  "workingDir": "C:\\\\Projects"
}
\`\`\`

Example usage (Git Bash):
\`\`\`json
{
  "shell": "gitbash",
  "command": "ls -la",
  "workingDir": "/c/Users/username"
}
\`\`\``,
  'Command Execution'
);
```

#### Task 2.3: Update Other Command Tools

Apply similar changes to:
- `StartBackgroundJobTool.ts` - Add env parameter support
- `ExecuteBatchTool.ts` - Add env parameter support for batch commands

#### Task 2.4: Update SSH Tools for Environment Variable Support

**File:** `src/tools/ssh/SSHExecuteTool.ts`

SSH commands often need environment variables for proper execution. Add support for passing environment variables to remote commands.

**Update Interface:**

```typescript
interface SSHExecuteArgs {
  connectionId: string;
  command: string;
  timeout?: number;
  env?: Record<string, string>;  // NEW
}
```

**Update getInputSchema():**

```typescript
getInputSchema() {
  return {
    type: 'object',
    properties: {
      connectionId: {
        type: 'string',
        description: 'ID of the SSH connection to use'
      },
      command: {
        type: 'string',
        description: 'Command to execute'
      },
      timeout: {
        type: 'number',
        description: 'Command timeout in seconds'
      },
      env: {  // NEW
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Custom environment variables to set before command execution'
      }
    },
    required: ['connectionId', 'command']
  };
}
```

**Update execute() method:**

For SSH, environment variables are typically set inline before the command:

```typescript
async execute(args: SSHExecuteArgs): Promise<ToolResult> {
  const { connectionId, command, timeout, env } = args;

  // Validate environment variables
  if (env) {
    const securityManager = this.getService<SecurityManager>('SecurityManager');
    securityManager.validateEnvironmentVariables(env, 'ssh');
  }

  // Build command with environment variable prefix
  let finalCommand = command;
  if (env && Object.keys(env).length > 0) {
    const envPrefix = Object.entries(env)
      .map(([key, value]) => {
        // Escape single quotes in values for shell safety
        const escapedValue = value.replace(/'/g, "'\\''");
        return `export ${key}='${escapedValue}'`;
      })
      .join(' && ');
    finalCommand = `${envPrefix} && ${command}`;
  }

  // Execute via SSH connection pool
  // ... rest of existing implementation ...
}
```

**Tests:** `__tests__/tools/ssh/SSHExecuteTool.test.ts`

```typescript
describe('SSHExecuteTool - Environment Variables', () => {
  test('should pass environment variables to remote command', async () => {
    const result = await tool.execute({
      connectionId: 'test-server',
      command: 'echo $MY_VAR',
      env: { MY_VAR: 'test-value' }
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('test-value');
  });

  test('should escape special characters in env values', async () => {
    const result = await tool.execute({
      connectionId: 'test-server',
      command: 'echo $SPECIAL',
      env: { SPECIAL: "value'with'quotes" }
    });

    expect(result.success).toBe(true);
  });

  test('should block sensitive environment variables', async () => {
    const result = await tool.execute({
      connectionId: 'test-server',
      command: 'echo test',
      env: { AWS_SECRET_ACCESS_KEY: 'secret' }
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('blocked');
  });
});
```

**Security Note:** SSH environment variables are set via shell export commands, so they must be properly escaped to prevent command injection. The implementation uses single-quote escaping which is safe for most shells (bash, zsh, sh).

### Phase 3: Documentation & Examples (Day 3)

#### Task 3.0: Update check_security_config for Environment Variables

**File:** `src/tools/diagnostics/CheckSecurityConfigTool.ts`

Update the check_security_config tool to display environment variable security rules when requested.

**Update getInputSchema() to include new category:**

```typescript
getInputSchema() {
  return {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['all', 'commands', 'paths', 'operators', 'limits', 'environment'],  // NEW: 'environment'
        description: 'Filter by configuration category (optional, default: all)'
      }
    },
    required: []
  };
}
```

**Add environment variable output section:**

```typescript
private getEnvironmentConfig(): object {
  const config = this.configManager.getConfig();
  const security = config.security;

  return {
    blockedEnvVars: security.blockedEnvVars || [],
    allowedEnvVars: security.allowedEnvVars || null,  // null means blocklist mode
    maxCustomEnvVars: security.maxCustomEnvVars || 20,
    maxEnvVarValueLength: security.maxEnvVarValueLength || 32768,
    mode: security.allowedEnvVars ? 'allowlist' : 'blocklist',
    shellDefaults: Object.entries(config.shells)
      .filter(([_, shell]) => shell.defaultEnv && Object.keys(shell.defaultEnv).length > 0)
      .reduce((acc, [name, shell]) => {
        acc[name] = Object.keys(shell.defaultEnv!);
        return acc;
      }, {} as Record<string, string[]>)
  };
}
```

**Update execute() to handle 'environment' category:**

```typescript
async execute(args: { category?: string }): Promise<ToolResult> {
  const category = args.category || 'all';

  const result: Record<string, any> = {};

  if (category === 'all' || category === 'commands') {
    result.commands = this.getCommandsConfig();
  }

  if (category === 'all' || category === 'paths') {
    result.paths = this.getPathsConfig();
  }

  if (category === 'all' || category === 'operators') {
    result.operators = this.getOperatorsConfig();
  }

  if (category === 'all' || category === 'limits') {
    result.limits = this.getLimitsConfig();
  }

  // NEW: Environment variable configuration
  if (category === 'all' || category === 'environment') {
    result.environment = this.getEnvironmentConfig();
  }

  return this.success(JSON.stringify(result, null, 2));
}
```

**Example output for `check_security_config { category: 'environment' }`:**

```json
{
  "environment": {
    "blockedEnvVars": [
      "AWS_SECRET_ACCESS_KEY",
      "AWS_ACCESS_KEY_ID",
      "AZURE_CLIENT_SECRET",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GITHUB_TOKEN",
      "PASSWORD",
      "TOKEN",
      "SECRET",
      "API_KEY",
      "PATH",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "DYLD_INSERT_LIBRARIES",
      "DYLD_LIBRARY_PATH"
    ],
    "allowedEnvVars": null,
    "maxCustomEnvVars": 20,
    "maxEnvVarValueLength": 32768,
    "mode": "blocklist",
    "shellDefaults": {
      "powershell": ["PYTHONIOENCODING", "PYTHONUTF8"]
    }
  }
}
```

**Tests:** `__tests__/tools/diagnostics/CheckSecurityConfigTool.test.ts`

```typescript
describe('CheckSecurityConfigTool - Environment Variables', () => {
  test('should return environment config when category is environment', async () => {
    const result = await tool.execute({ category: 'environment' });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.environment).toBeDefined();
    expect(parsed.environment.blockedEnvVars).toBeInstanceOf(Array);
    expect(parsed.environment.mode).toBe('blocklist');
  });

  test('should include environment in all category', async () => {
    const result = await tool.execute({ category: 'all' });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.environment).toBeDefined();
  });

  test('should show allowlist mode when allowedEnvVars configured', async () => {
    // Configure with allowlist
    const customConfig = {
      ...mockConfig,
      security: {
        ...mockConfig.security,
        allowedEnvVars: ['PYTHONIOENCODING', 'NODE_ENV']
      }
    };

    const customTool = new CheckSecurityConfigTool(customContainer);
    const result = await customTool.execute({ category: 'environment' });

    const parsed = JSON.parse(result.content);
    expect(parsed.environment.mode).toBe('allowlist');
    expect(parsed.environment.allowedEnvVars).toEqual(['PYTHONIOENCODING', 'NODE_ENV']);
  });

  test('should show shell defaults in environment config', async () => {
    const customConfig = {
      ...mockConfig,
      shells: {
        ...mockConfig.shells,
        powershell: {
          ...mockConfig.shells.powershell,
          defaultEnv: {
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1'
          }
        }
      }
    };

    const customTool = new CheckSecurityConfigTool(customContainer);
    const result = await customTool.execute({ category: 'environment' });

    const parsed = JSON.parse(result.content);
    expect(parsed.environment.shellDefaults.powershell).toEqual(['PYTHONIOENCODING', 'PYTHONUTF8']);
  });
});
```

#### Task 3.1: Update README.md

**Add new section under "Configuration":**

```markdown
### Environment Variable Configuration

#### Custom Environment Variables

Pass custom environment variables to commands for specific execution contexts:

\`\`\`json
{
  "tool": "execute_command",
  "arguments": {
    "shell": "powershell",
    "command": "python script.py",
    "env": {
      "PYTHONIOENCODING": "utf-8",
      "PYTHONUTF8": "1",
      "DEBUG": "1"
    }
  }
}
\`\`\`

#### Shell Default Environment Variables

Configure default environment variables for each shell:

\`\`\`json
{
  "shells": {
    "powershell": {
      "enabled": true,
      "command": "powershell.exe",
      "args": ["-NoProfile", "-NonInteractive", "-Command"],
      "defaultEnv": {
        "PYTHONIOENCODING": "utf-8",
        "PSModulePath": "C:\\\\CustomModules;$env:PSModulePath"
      }
    }
  }
}
\`\`\`

#### Security Controls

Control which environment variables can be set:

\`\`\`json
{
  "security": {
    "blockedEnvVars": [
      "AWS_SECRET_ACCESS_KEY",
      "ANTHROPIC_API_KEY",
      "PASSWORD",
      "TOKEN"
    ],
    "maxCustomEnvVars": 20
  }
}
\`\`\`

**Use allowlist mode for stricter control:**

\`\`\`json
{
  "security": {
    "allowedEnvVars": [
      "PYTHONIOENCODING",
      "PYTHONUTF8",
      "NODE_ENV",
      "DEBUG"
    ]
  }
}
\`\`\`
```

**Add troubleshooting section:**

```markdown
### Issue: Unicode/UTF-8 Encoding Errors

**Symptoms:**
- Python tools display `UnicodeEncodeError`
- Unicode characters (emoji, CJK, symbols) render incorrectly
- Error: `'charmap' codec can't encode characters`

**Solution:**

Set UTF-8 encoding environment variables:

\`\`\`json
{
  "tool": "execute_command",
  "arguments": {
    "shell": "powershell",
    "command": "python -m pip list",
    "env": {
      "PYTHONIOENCODING": "utf-8",
      "PYTHONUTF8": "1"
    }
  }
}
\`\`\`

Or configure shell defaults:

\`\`\`json
{
  "shells": {
    "powershell": {
      "defaultEnv": {
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUTF8": "1"
      }
    }
  }
}
\`\`\`
```

#### Task 3.2: Update config.json.example

Add examples for new configuration options.

#### Task 3.3: Create Migration Guide

**File:** `docs/MIGRATION_0.3_to_0.4.md`

Document breaking changes and migration path (if any).

### Phase 4: Testing & Quality Assurance

#### Task 4.1: Unit Tests

- ✅ EnvironmentManager.test.ts - validation, merging, precedence
- ✅ SecurityManager.test.ts - env var validation stage
- ✅ CommandExecutor.test.ts - env passing, merging, UTF-8
- ✅ ExecuteCommandTool.test.ts - integration tests

#### Task 4.2: Integration Tests

**File:** `__tests__/integration/environment-variables.test.ts`

```typescript
describe('Environment Variables Integration', () => {
  test('should execute Python with UTF-8 encoding', async () => {
    // Test real spec-kit scenario
  });

  test('should handle environment variable precedence', async () => {
    // Test system < shell < user precedence
  });

  test('should block sensitive environment variables', async () => {
    // Test security enforcement
  });

  test('should pass environment variables via SSH', async () => {
    // Test SSH tool with env vars
  });

  test('should validate config defaultEnv against blocklist at load time', async () => {
    // Test config-time validation
  });

  test('should reject env var values with null bytes', async () => {
    // Test value validation
  });

  test('should show environment config in check_security_config', async () => {
    // Test diagnostic tool update
  });
});
```

#### Task 4.3: Manual Testing

Test cases:
1. ✅ spec-kit `specify check` with UTF-8 encoding
2. ✅ Python scripts with Unicode output
3. ✅ Environment variable security blocks
4. ✅ Shell default environment variables
5. ✅ Precedence ordering (system < shell < user)

---

## Migration & Backward Compatibility

### Breaking Changes

**NONE** - All new features are opt-in:
- `env` parameter is optional
- `defaultEnv` in shell config is optional
- New security config fields have defaults

### Deprecations

**NONE** - No existing functionality is deprecated

### Configuration Updates

Users can opt-in to new features by:
1. Adding `env` parameter to command calls
2. Adding `defaultEnv` to shell configurations
3. Configuring `blockedEnvVars` / `allowedEnvVars` if needed

---

## Success Criteria

### Functional Requirements

- ✅ Can pass custom environment variables to commands
- ✅ Can configure shell-specific default environment variables
- ✅ Environment variable precedence works correctly
- ✅ Security validation blocks sensitive variables
- ✅ UTF-8 encoding resolves spec-kit Unicode issues

### Non-Functional Requirements

- ✅ Zero breaking changes to existing API
- ✅ Performance impact <5ms per command
- ✅ All tests pass (unit + integration)
- ✅ Documentation covers all use cases
- ✅ TypeScript compilation with no errors

### Validation Tests

1. **spec-kit Unicode test:**
   ```bash
   specify check  # Should display Unicode banner without errors
   ```

2. **Python UTF-8 test:**
   ```bash
   python -c "print('Hello 世界')"  # Should output correctly
   ```

3. **Security test:**
   ```bash
   # Should block attempt to set AWS_SECRET_ACCESS_KEY
   ```

---

## Risk Analysis

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Environment variable conflicts | Medium | Low | Document precedence clearly, provide diagnostic tools |
| Security bypass via env vars | Low | High | Strong validation, blocklist defaults, testing |
| Performance degradation | Low | Low | Benchmark spawn times, optimize merging |
| Breaking existing workflows | Low | Medium | Comprehensive testing, optional features |

### Security Risks

| Risk | Mitigation |
|------|------------|
| Credential leakage via env vars | Blocklist sensitive patterns by default |
| Command injection via env values | Validate env var names, sanitize in logs |
| Privilege escalation via PATH | Block system-critical env vars |
| Information disclosure in errors | Sanitize env var values in error messages |

---

## Future Enhancements

### Phase 2 (Future)

1. **Environment Variable Presets**
   - Pre-defined bundles (python-utf8, dev-mode, etc.)
   - Easier common configurations

2. **Dynamic Environment Variables**
   - Template substitution (e.g., `${HOME}/.config`)
   - Computed values from system state

3. **Environment Variable Validation**
   - Type checking (ensure PORT is numeric)
   - Format validation (ensure URL is valid)

4. **Audit Logging**
   - Log environment variable usage
   - Track security policy violations

---

## Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Core Infrastructure | 1.5 days | None |
| Phase 2: Command Execution + SSH | 1.5 days | Phase 1 |
| Phase 3: Documentation | 0.5 days | Phase 2 |
| Phase 4: Testing & QA | 0.5 days | Phase 1-3 |
| **Total** | **4 days** | |

**Note:** Timeline increased from 3 to 4 days to accommodate:
- Config-time validation for defaultEnv conflicts
- SSH tool environment variable support
- Value validation (length, null bytes, control chars)
- check_security_config environment category

---

## Appendix A: Example Configurations

### Example 1: Python Development

```json
{
  "shells": {
    "powershell": {
      "enabled": true,
      "command": "powershell.exe",
      "args": ["-NoProfile", "-NonInteractive", "-Command"],
      "defaultEnv": {
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUTF8": "1",
        "PYTHONDONTWRITEBYTECODE": "1"
      }
    }
  }
}
```

### Example 2: Node.js Development

```json
{
  "shells": {
    "powershell": {
      "enabled": true,
      "command": "powershell.exe",
      "args": ["-NoProfile", "-NonInteractive", "-Command"],
      "defaultEnv": {
        "NODE_ENV": "development",
        "NODE_OPTIONS": "--max-old-space-size=4096"
      }
    }
  }
}
```

### Example 3: Secure Production Environment

```json
{
  "security": {
    "allowedEnvVars": [
      "NODE_ENV",
      "DEBUG",
      "LOG_LEVEL",
      "PYTHONIOENCODING",
      "PYTHONUTF8"
    ],
    "maxCustomEnvVars": 10
  }
}
```

---

## Appendix B: API Reference

### New Parameter: `env`

**Type:** `Record<string, string> | undefined`

**Description:** Custom environment variables to set for the command execution

**Example:**
```json
{
  "env": {
    "PYTHONIOENCODING": "utf-8",
    "DEBUG": "myapp:*"
  }
}
```

**Validation:**
- Must not exceed `maxCustomEnvVars` limit
- Variable names must not be in `blockedEnvVars`
- Variable names must be in `allowedEnvVars` (if allowlist mode enabled)

**Precedence:**
1. System environment variables (lowest)
2. Shell `defaultEnv` configuration
3. User-provided `env` parameter (highest)

---

## Appendix C: Testing Checklist

### Unit Tests
- [ ] EnvironmentManager.validateEnvVarName()
- [ ] EnvironmentManager.validateEnvVars()
- [ ] EnvironmentManager.validateEnvVarValue()
- [ ] EnvironmentManager.mergeEnvironmentVariables()
- [ ] SecurityManager.validateEnvironmentVariables()
- [ ] CommandExecutor environment variable passing
- [ ] ExecuteCommandTool env parameter validation
- [ ] SSHExecuteTool env parameter validation
- [ ] ConfigManager.validateDefaultEnvAgainstBlocklist()
- [ ] ConfigManager.validateDefaultEnvValueLengths()
- [ ] CheckSecurityConfigTool environment category

### Integration Tests
- [ ] spec-kit Unicode rendering
- [ ] Python UTF-8 output
- [ ] Node.js environment variables
- [ ] Environment variable precedence
- [ ] Security blocklist enforcement
- [ ] Error handling and sanitization
- [ ] SSH environment variable passing
- [ ] Config conflict detection at load time
- [ ] Value validation (null bytes, length, control chars)

### Manual Tests
- [ ] spec-kit check command works
- [ ] Python scripts with Unicode
- [ ] Multiple env vars simultaneously
- [ ] Shell defaults merge correctly
- [ ] User overrides work
- [ ] Security blocks sensitive vars
- [ ] SSH commands with env vars
- [ ] check_security_config shows environment rules

---

**Document Version:** 1.1
**Author:** Claude (Anthropic)
**Date:** 2025-11-19
**Status:** READY FOR IMPLEMENTATION

**Revision History:**
- v1.1 (2025-11-19): Added config merge strategies, SSH tool support, config-time validation, value validation, check_security_config update, PATH to blocklist. Timeline updated to 4 days.
- v1.0 (2025-01-19): Initial version
