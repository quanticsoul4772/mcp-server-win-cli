# Path Sanitization Verification Tests

## Test Coverage

This document outlines the verification tests for path sanitization implementation.

## Manual Testing Commands

### Test 1: Working Directory Not a Directory Error (Line 753)
```json
{
  "name": "execute_command",
  "arguments": {
    "shell": "powershell",
    "command": "echo test",
    "workingDir": "C:\\Windows\\System32\\notepad.exe"
  }
}
```

**Expected Result:**
- Error message shows: `Working directory path is not a directory: C:\Windows\System32\notepad.exe`
- Path is shown because it's user-provided (safe to show back to user)
- If the real path differs, it should be sanitized

### Test 2: Working Directory Not in Allowed Paths (Lines 762-778)
```json
{
  "name": "execute_command",
  "arguments": {
    "shell": "powershell",
    "command": "echo test",
    "workingDir": "C:\\Windows\\Temp"
  }
}
```

**Expected Result:**
```
Working directory is not in allowed paths.

WHY: Path restrictions prevent commands from executing in untrusted directories...

TO FIX:
1. Edit your config file: ~/.win-cli-mcp/config.json (or sanitized path)
2. Add the working directory to the "security.allowedPaths" array
3. Note: The config uses secure merge - paths must exist in BOTH default and user config
4. Alternative: Set "security.restrictWorkingDirectory" to false (NOT recommended)
5. Use the check_security_config tool with category="paths" to view allowed directories
6. Restart the MCP server

WARNING: Adding broad paths (like C:\) weakens security...

TIP: Use the check_security_config tool to view current allowed paths...
```

**Key Verification Points:**
- ✅ No specific path disclosure in error message
- ✅ Config path is sanitized (~/... instead of C:\Users\username\...)
- ✅ Error directs user to check_security_config tool
- ✅ No enumeration of allowed paths in error message

### Test 3: Working Directory Metadata (Line 879)
```json
{
  "name": "execute_command",
  "arguments": {
    "shell": "powershell",
    "command": "echo test",
    "workingDir": "."
  }
}
```

**Expected Result in Metadata:**
```json
{
  "metadata": {
    "exitCode": 0,
    "shell": "powershell",
    "workingDirectory": "~\\Projects\\..." // Sanitized, not full path with username
  }
}
```

**Key Verification Points:**
- ✅ workingDirectory in metadata is sanitized
- ✅ Username replaced with [user] or path starts with ~
- ✅ User-provided relative paths are resolved and sanitized

### Test 4: Validate Command Tool (Line 1220)
```json
{
  "name": "validate_command",
  "arguments": {
    "shell": "powershell",
    "command": "echo test",
    "workingDir": "C:\\Windows\\Temp"
  }
}
```

**Expected Result:**
```json
{
  "valid": false,
  "checks": {
    "path_allowed": false,
    ...
  },
  "errors": [
    "Working directory is not in allowed paths. Use check_security_config tool with category=\"paths\" to view allowed directories."
  ]
}
```

**Key Verification Points:**
- ✅ No path disclosure in error
- ✅ Directs to diagnostic tool
- ✅ No enumeration of allowed paths

### Test 5: Config Path Sanitization in Validation Errors
Trigger a command blocking error to see config path in error message:

```json
{
  "name": "execute_command",
  "arguments": {
    "shell": "powershell",
    "command": "rm -rf /"
  }
}
```

**Expected Result:**
```
Command 'rm' is blocked by security policy.

WHY: This command can modify system state...

TO FIX:
1. Edit your config file: ~/.win-cli-mcp/config.json (SANITIZED PATH)
2. Remove 'rm' from the "security.blockedCommands" array
3. Restart the MCP server

WARNING: Allowing 'rm' removes an important security protection...
```

**Key Verification Points:**
- ✅ Config path is sanitized (~ instead of full path)
- ✅ No username disclosure
- ✅ Works with both custom config and default config locations

### Test 6: Check Security Config Tool (Verify It Still Works)
```json
{
  "name": "check_security_config",
  "arguments": {
    "category": "paths"
  }
}
```

**Expected Result:**
```json
{
  "allowed_paths": [
    "C:\\Users\\username\\Documents",
    "C:\\Users\\username\\Projects"
  ],
  "restrict_working_directory": true
}
```

**Key Verification Points:**
- ✅ This tool SHOULD show full paths (intended for user's reference)
- ✅ This is the diagnostic tool that error messages point to
- ✅ Users can use this to see their allowed paths

## Automated Test Cases

### Unit Tests for errorSanitizer.ts

```typescript
describe('sanitizePathError', () => {
  it('should replace home directory with ~', () => {
    const input = 'C:\\Users\\Administrator\\Documents\\test';
    const result = sanitizePathError(input);
    expect(result).not.toContain('Administrator');
    expect(result).toContain('~');
  });

  it('should preserve user-provided paths', () => {
    const input = 'C:\\Users\\Administrator\\Documents\\test';
    const userPath = 'C:\\Users\\Administrator\\Documents\\test';
    const result = sanitizePathError(input, userPath);
    expect(result).toBe(userPath);
  });

  it('should mask usernames', () => {
    const input = 'C:\\Users\\johndoe\\AppData\\Local\\temp';
    const result = sanitizePathError(input);
    expect(result).not.toContain('johndoe');
    expect(result).toMatch(/\[user\]/);
  });
});

describe('sanitizeConfigPath', () => {
  it('should sanitize config file paths', () => {
    const input = 'C:\\Users\\Administrator\\.win-cli-mcp\\config.json';
    const result = sanitizeConfigPath(input);
    expect(result).not.toContain('Administrator');
    expect(result).toContain('~');
  });
});

describe('sanitizeErrorMessage', () => {
  it('should sanitize paths in error messages', () => {
    const error = new Error('File not found: C:\\Users\\Administrator\\test.txt');
    const result = sanitizeErrorMessage(error);
    expect(result).not.toContain('Administrator');
  });
});
```

### Integration Tests

```typescript
describe('Path Sanitization Integration', () => {
  it('should sanitize working directory errors', async () => {
    const result = await server.executeCommand({
      shell: 'powershell',
      command: 'echo test',
      workingDir: 'C:\\Windows\\Temp'
    });

    expect(result.error).not.toContain('Users');
    expect(result.error).not.toContain(process.env.USERNAME);
    expect(result.error).toContain('check_security_config');
  });

  it('should sanitize metadata paths', async () => {
    const result = await server.executeCommand({
      shell: 'powershell',
      command: 'echo test',
      workingDir: process.cwd()
    });

    expect(result.metadata.workingDirectory).not.toContain(process.env.USERNAME);
  });
});
```

## Security Regression Tests

### Test for Username Disclosure
```bash
# Grep for any username disclosure in output
npm test 2>&1 | grep -i "Administrator\|Users\\\\" || echo "PASS: No username disclosure"
```

### Test for Path Disclosure
```bash
# Run all tests and check for full paths in error messages
npm test 2>&1 | grep -E "C:\\\\Users\\\\[^\\\\]+\\\\" || echo "PASS: No full user paths disclosed"
```

## Build Verification

```bash
# Ensure TypeScript compilation succeeds
npm run build

# Check for any TypeScript errors
echo $? # Should be 0
```

## Checklist

- [x] errorSanitizer.ts enhanced with new functions
- [x] sanitizePathError() implemented
- [x] sanitizeConfigPath() implemented
- [x] sanitizeErrorMessage() enhanced
- [x] src/index.ts imports updated
- [x] Line 753 sanitized (working directory not a directory)
- [x] Lines 762-778 sanitized (allowed paths error)
- [x] Line 879 sanitized (metadata workingDirectory)
- [x] Line 1220 sanitized (validate_command error)
- [x] src/utils/validation.ts imports updated
- [x] getConfigLocationMessage() sanitized
- [x] Build succeeds without errors
- [ ] Manual testing completed
- [ ] Unit tests written and passing
- [ ] Integration tests written and passing
- [ ] Security regression tests passing

## Notes

- All changes are backward incompatible by design (security improvement)
- Error messages now guide users to diagnostic tools instead of showing full paths
- Config paths are sanitized but still provide enough context for users to find the file
- User-provided paths in input are shown back to user (safe)
- Internal resolved paths are sanitized (secure)
