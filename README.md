# Windows CLI MCP Server

> [!NOTE]
> This is a fork of the original [win-cli-mcp-server](https://github.com/SimonB97/win-cli-mcp-server) by Simon Benedict.
> This fork includes additional security fixes, API improvements, and new tools for enhanced functionality.

> [!NOTE]
> v0.3.0 - Active development with security improvements and enhanced stability.

[MCP server](https://modelcontextprotocol.io/introduction) for secure command-line interactions on Windows systems, enabling controlled access to PowerShell, CMD, Git Bash shells, and remote systems via SSH. It allows MCP clients (like [Claude Desktop](https://claude.ai/download)) to perform operations on your system.

## What's New in v0.3.0

**New Capabilities:**
- SFTP file transfer operations (upload, download, list, delete)
- WSL path support for SFTP tools (converts /mnt/c/ and \\wsl.localhost\ paths)
- Background job execution with streaming output
- Batch command execution
- System monitoring (CPU usage, disk space)
- Network diagnostics (DNS lookup, connectivity testing)
- Environment variable access with security filtering
- Configuration value retrieval

**Security Improvements:**
- Fixed path traversal, command injection, and race condition vulnerabilities
- SSH host key verification with Trust On First Use (TOFU)
- Error message sanitization
- Remote shell type auto-detection with validation
- Connection pool limits with automatic cleanup
- Secure configuration merge that preserves security settings

>[!IMPORTANT]
> This MCP server provides direct access to your system's command line interface and remote systems via SSH. When enabled, it grants access to your files, environment variables, command execution capabilities, and remote server management. Review and restrict allowed paths and SSH connections, enable directory restrictions, and configure command blocks. See [Configuration](#configuration) for details.

- [Features](#features)
- [Usage with Claude Desktop](#usage-with-claude-desktop)
- [Configuration](#configuration)
  - [Configuration Locations](#configuration-locations)
  - [Default Configuration](#default-configuration)
  - [Configuration Settings](#configuration-settings)
    - [Security Settings](#security-settings)
    - [Shell Configuration](#shell-configuration)
    - [SSH Configuration](#ssh-configuration)
- [API](#api)
  - [Tools](#tools)
  - [Resources](#resources)
- [Troubleshooting](#troubleshooting)
  - [Understanding Exit Codes](#understanding-exit-codes)
  - [Issue: "Command is blocked"](#issue-command-is-blocked-or-command-contains-blocked-command)
  - [Issue: "Path not allowed"](#issue-path-not-allowed-or-working-directory-outside-allowed-paths)
  - [Issue: SSH Connection Failed](#issue-ssh-connection-failed)
  - [Issue: Command Times Out](#issue-command-times-out)
  - [Issue: Shell Operators Blocked](#issue-shell-operators-blocked-pipes-redirects-command-chaining)
  - [Using Diagnostic Tools](#using-diagnostic-tools)
  - [Getting Help](#getting-help)
- [License](#license)

## Features

- Multi-shell support: Execute commands in PowerShell, Command Prompt (CMD), and Git Bash
- SSH support: Execute commands on remote systems via SSH
- Resource exposure: View SSH connections, current directory, and configuration as MCP resources
- Security controls:
  - SSH host key verification (prevents MITM attacks)
  - Command and SSH command blocking (full paths, case variations)
  - Working directory validation
  - Maximum command length limits
  - Command logging and history tracking
  - Smart argument validation
- Configurable:
  - Custom security rules
  - Shell-specific settings
  - SSH connection profiles
  - Path restrictions
  - Blocked command lists

See the [API](#api) section for details on the tools and resources the server provides to MCP clients.

Note: The server will only allow operations within configured directories, with allowed commands, and on configured SSH connections.

## Architecture

The server uses a layered architecture with dependency injection for maintainability and testability:

**Foundation Layer:**
- ServiceContainer: Lightweight dependency injection with singleton, transient, and instance lifecycles
- ToolRegistry: Manages tool registration, discovery, and execution

**Service Layer:**
- ConfigManager: Configuration loading and validation
- SecurityManager: Multi-stage command validation pipeline
- CommandExecutor: Process spawning and timeout management
- HistoryManager: Command history tracking with size limits
- EnvironmentManager: Secure environment variable access with blocklist/allowlist
- JobManager: Background job execution with lifecycle management
- SSHConnectionPool: SSH connection management with LRU eviction

**Presentation Layer:**
- 34 MCP tools organized by category (command execution, SSH operations, diagnostics, system info)
- All tools extend BaseTool abstract class
- Tools use dependency injection to access services

This architecture provides separation of concerns, making the codebase easier to maintain and extend. For detailed architecture documentation, see CLAUDE.md.

## Usage with Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "windows-cli": {
      "command": "npx",
      "args": ["-y", "@quanticsoul4772/mcp-server-win-cli"]
    }
  }
}
```

For use with a specific config file, add the `--config` flag:

```json
{
  "mcpServers": {
    "windows-cli": {
      "command": "npx",
      "args": [
        "-y",
        "@quanticsoul4772/mcp-server-win-cli",
        "--config",
        "path/to/your/config.json"
      ]
    }
  }
}
```

After configuring, you can:
- Execute commands directly using the available tools
- View configured SSH connections and server configuration in the Resources section
- Manage SSH connections through the provided tools

## Configuration

The server uses a JSON configuration file to customize its behavior. You can specify settings for security controls, shell configurations, and SSH connections.

1. To create a default config file, either:

**a)** copy `config.json.example` to `config.json`, or

**b)** run:

```bash
npx @quanticsoul4772/mcp-server-win-cli --init-config ./config.json
```

2. Then set the `--config` flag to point to your config file as described in the [Usage with Claude Desktop](#usage-with-claude-desktop) section.

### Configuration Locations

The server looks for configuration in the following locations (in order):

1. Path specified by `--config` flag
2. ./config.json in current directory
3. ~/.win-cli-mcp/config.json in user's home directory

If no configuration file is found, the server will use a default (restricted) configuration:

### Default Configuration

Note: The default configuration is designed to be restrictive and secure. Find more details on each setting in the [Configuration Settings](#configuration-settings) section.

```json
{
  "security": {
    "maxCommandLength": 2000,
    "blockedCommands": [
      "rm",
      "del",
      "rmdir",
      "format",
      "shutdown",
      "restart",
      "reg",
      "regedit",
      "net",
      "netsh",
      "takeown",
      "icacls"
    ],
    "blockedArguments": [
      "--exec",
      "-e",
      "/c",
      "-enc",
      "-encodedcommand",
      "-command",
      "--interactive",
      "-i",
      "--login",
      "--system"
    ],
    "allowedPaths": ["User's home directory", "Current working directory"],
    "restrictWorkingDirectory": true,
    "logCommands": true,
    "maxHistorySize": 1000,
    "commandTimeout": 30
  },
  "shells": {
    "powershell": {
      "enabled": true,
      "command": "powershell.exe",
      "args": ["-NoProfile", "-NonInteractive", "-Command"],
      "blockedOperators": ["&", "|", ";", "`"]
    },
    "cmd": {
      "enabled": true,
      "command": "cmd.exe",
      "args": ["/c"],
      "blockedOperators": ["&", "|", ";", "`"]
    },
    "gitbash": {
      "enabled": true,
      "command": "C:\\Program Files\\Git\\bin\\bash.exe",
      "args": ["-c"],
      "blockedOperators": ["&", "|", ";", "`"]
    }
  },
  "ssh": {
    "enabled": false,
    "defaultTimeout": 30,
    "maxConcurrentSessions": 5,
    "keepaliveInterval": 10000,
    "keepaliveCountMax": 3,
    "readyTimeout": 20000,
    "connections": {}
  }
}
```

### Configuration Settings

The configuration file is divided into three main sections: `security`, `shells`, and `ssh`.

#### Security Settings

```json
{
  "security": {
    // Maximum allowed length for any command
    "maxCommandLength": 1000,

    // Commands to block - blocks both direct use and full paths
    // Example: "rm" blocks both "rm" and "C:\\Windows\\System32\\rm.exe"
    // Case-insensitive: "del" blocks "DEL.EXE", "del.cmd", etc.
    "blockedCommands": [
      "rm", // Delete files
      "del", // Delete files
      "rmdir", // Delete directories
      "format", // Format disks
      "shutdown", // Shutdown system
      "restart", // Restart system
      "reg", // Registry editor
      "regedit", // Registry editor
      "net", // Network commands
      "netsh", // Network commands
      "takeown", // Take ownership of files
      "icacls" // Change file permissions
    ],

    // Arguments that will be blocked when used with any command
    // Note: Checks each argument independently - "cd warm_dir" won't be blocked just because "rm" is in blockedCommands
    "blockedArguments": [
      "--exec", // Execution flags
      "-e", // Short execution flags
      "/c", // Command execution in some shells
      "-enc", // PowerShell encoded commands
      "-encodedcommand", // PowerShell encoded commands
      "-command", // Direct PowerShell command execution
      "--interactive", // Interactive mode which might bypass restrictions
      "-i", // Short form of interactive
      "--login", // Login shells might have different permissions
      "--system" // System level operations
    ],

    // List of directories where commands can be executed
    "allowedPaths": ["C:\\Users\\YourUsername", "C:\\Projects"],

    // If true, commands can only run in allowedPaths
    "restrictWorkingDirectory": true,

    // If true, saves command history
    "logCommands": true,

    // Maximum number of commands to keep in history
    "maxHistorySize": 1000,

    // Timeout for command execution in seconds (default: 30)
    "commandTimeout": 30,

    // Environment variable security controls
    // Blocked patterns - variables matching these are blocked (default includes sensitive vars)
    "blockedEnvVars": [
      "AWS_SECRET_ACCESS_KEY",
      "PASSWORD",
      "API_KEY",
      "TOKEN",
      "SECRET",
      "PATH",           // Prevents PATH manipulation attacks
      "LD_PRELOAD"      // Prevents library injection attacks
    ],

    // Optional: If set, ONLY these variables can be modified (allowlist mode)
    // "allowedEnvVars": ["PYTHONIOENCODING", "PYTHONUTF8", "NODE_ENV"],

    // Maximum number of custom environment variables per command (default: 20)
    "maxCustomEnvVars": 20,

    // Maximum length of environment variable values (default: 32768)
    "maxEnvVarValueLength": 32768
  }
}
```

#### Shell Configuration

```json
{
  "shells": {
    "powershell": {
      // Enable/disable this shell
      "enabled": true,
      // Path to shell executable
      "command": "powershell.exe",
      // Default arguments for the shell
      "args": ["-NoProfile", "-NonInteractive", "-Command"],
      // Optional: Specify which command operators to block
      "blockedOperators": ["&", "|", ";", "`"],  // Block all command chaining
      // Optional: Default environment variables for this shell
      "defaultEnv": {
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUTF8": "1"
      }
    },
    "cmd": {
      "enabled": true,
      "command": "cmd.exe",
      "args": ["/c"],
      "blockedOperators": ["&", "|", ";", "`"]  // Block all command chaining
    },
    "gitbash": {
      "enabled": true,
      "command": "C:\\Program Files\\Git\\bin\\bash.exe",
      "args": ["-c"],
      "blockedOperators": ["&", "|", ";", "`"]  // Block all command chaining
    }
  }
}
```

### WSL Path Support

The SFTP tools (`sftp_download`, `sftp_upload`) support downloading and uploading files to Windows Subsystem for Linux (WSL) paths:

**Supported path formats:**
- `\\wsl.localhost\Ubuntu\home\user\file` - WSL network path (recommended)
- `\\wsl$\Ubuntu\home\user\file` - WSL legacy network path
- `/home/user/file` - Unix absolute path (uses default distribution)
- `/mnt/c/Users/user/file` - WSL mount path format

**Requirements:**
- WSL must be installed: `wsl --install`
- At least one distribution must be configured
- Include WSL paths in `allowedPaths` configuration

**Example configuration:**
```json
{
  "security": {
    "allowedPaths": [
      "C:\\Users\\username",
      "\\\\wsl.localhost\\Ubuntu\\home\\username"
    ],
    "restrictWorkingDirectory": true
  }
}
```

**Troubleshooting WSL paths:**
- If you get "WSL is not installed" error, run `wsl --install` and restart
- If you get "Path not allowed" error, add the WSL path to `allowedPaths`
- Use `\\wsl.localhost\` paths for better compatibility with Windows tools

#### SSH Configuration

```json
{
  "ssh": {
    // Enable/disable SSH functionality
    "enabled": false,

    // Default timeout for SSH commands in seconds
    "defaultTimeout": 30,

    // Maximum number of concurrent SSH sessions
    "maxConcurrentSessions": 5,

    // Interval for sending keepalive packets (in milliseconds)
    "keepaliveInterval": 10000,

    // Maximum number of failed keepalive attempts before disconnecting
    "keepaliveCountMax": 3,

    // Timeout for establishing SSH connections (in milliseconds)
    "readyTimeout": 20000,

    // Enable strict host key checking (recommended for security)
    // - true (default): Reject connections to unknown hosts (prevents MITM attacks)
    // - false: Use Trust On First Use (TOFU) - accept and store new host keys
    "strictHostKeyChecking": true,

    // SSH connection profiles
    "connections": {
      // NOTE: these examples are not set in the default config!
      // Example: Local Raspberry Pi
      "raspberry-pi": {
        "host": "raspberrypi.local", // Hostname or IP address
        "port": 22, // SSH port
        "username": "pi", // SSH username
        "password": "raspberry", // Password authentication (if not using key)
        "keepaliveInterval": 10000, // Override global keepaliveInterval
        "keepaliveCountMax": 3, // Override global keepaliveCountMax
        "readyTimeout": 20000 // Override global readyTimeout
      },
      // Example: Remote server with key authentication
      "dev-server": {
        "host": "dev.example.com",
        "port": 22,
        "username": "admin",
        "privateKeyPath": "C:\\Users\\YourUsername\\.ssh\\id_rsa", // Path to private key
        "keepaliveInterval": 10000,
        "keepaliveCountMax": 3,
        "readyTimeout": 20000
      }
    }
  }
}
```

## API

### Tools

The server provides 34 MCP tools organized into 4 categories:

#### Command Execution (6 tools)

- **execute_command** - Execute a command in PowerShell, CMD, or Git Bash
- **read_command_history** - Get history of executed commands with outputs and exit codes
- **start_background_job** - Start a command as a background job (async execution)
- **get_job_status** - Get status and metadata for a background job
- **get_job_output** - Retrieve output from a background job with streaming support
- **execute_batch** - Execute multiple commands sequentially with stop-on-error mode

#### SSH Operations (12 tools)

- **ssh_execute** - Execute command on remote SSH host
- **ssh_disconnect** - Close SSH connection
- **create_ssh_connection** - Add new SSH connection to config
- **read_ssh_connections** - List all configured SSH connections
- **update_ssh_connection** - Modify existing SSH connection
- **delete_ssh_connection** - Remove SSH connection from config
- **read_ssh_pool_status** - Get SSH connection pool status and health
- **validate_ssh_connection** - Test SSH config and connectivity
- **sftp_upload** - Upload file to remote host via SFTP
- **sftp_download** - Download file from remote host via SFTP
- **sftp_list_directory** - List files/directories on remote host
- **sftp_delete** - Delete file or directory on remote host

#### Diagnostics & Configuration (12 tools)

- **check_security_config** - Inspect security rules (commands, paths, operators, limits, environment)
- **test_connection** - Test shell connectivity and basic functionality
- **validate_command** - Dry-run validation without execution
- **explain_exit_code** - Get detailed explanation for exit codes
- **validate_config** - Validate configuration file syntax
- **read_environment_variable** - Read single environment variable (with security filtering)
- **list_environment_variables** - List accessible environment variables
- **get_config_value** - Get specific config value by dot notation path
- **reload_config** - Validate and preview config reload
- **dns_lookup** - Perform DNS lookups (A, AAAA, MX, TXT, NS, CNAME records)
- **test_connectivity** - Test network connectivity with SSRF protection

#### System Info & Monitoring (4 tools)

- **read_current_directory** - Get current working directory
- **get_cpu_usage** - Get CPU usage with configurable sampling interval
- **get_disk_space** - Get disk space for specific drives or all drives
- **list_processes** - List running processes (disabled by default for security)

### Resources

The server exposes 5 MCP resources for configuration and status monitoring:

- **ssh://{connectionId}** - Individual SSH connection details (passwords masked)
- **ssh://config** - Complete SSH configuration with all connections
- **cli://currentdir** - Current working directory of the CLI server
- **cli://config** - CLI server configuration (sensitive data excluded)
- **cli://background-jobs** - Status of all background command execution jobs

## Troubleshooting

This section covers common issues and their solutions when using the Windows CLI MCP Server.

### Understanding Exit Codes

The server uses specific exit codes to indicate the result of command execution:

- **0**: Success - Command executed successfully
- **-1**: Execution failure - Command failed to run, timed out, or encountered a process error
- **-2**: Validation failure - Command was blocked by security rules before execution

When you see a non-zero exit code, check the error message to understand what went wrong.

### Issue: "Command is blocked" or "Command contains blocked command"

**Symptoms:**
- Command execution returns exit code `-2`
- Error message: "Command contains blocked command: [command]"
- Commands like `del`, `rm`, `shutdown`, or `reg` fail immediately

**Cause:**
The command or one of its arguments matches an entry in the `security.blockedCommands` or `security.blockedArguments` list. The server blocks these commands to prevent potentially dangerous operations.

**Solution:**

1. First, verify which commands are blocked using the diagnostic tool:
   ```json
   {
     "tool": "check_security_config",
     "arguments": {
       "category": "commands"
     }
   }
   ```

2. If you need to allow a specific command, create or edit your `config.json`:
   ```json
   {
     "security": {
       "blockedCommands": [
         // Remove the command you want to allow from this list
         // Or create a minimal list with only commands you want to block
         "format",
         "shutdown",
         "reg",
         "regedit"
       ]
     }
   }
   ```

3. **Important**: If you're using a custom config file, remember that the server uses secure merge logic:
   - **Blocked commands and arguments use UNION**: Both default blocks AND your custom blocks are combined
   - To completely override the defaults, you must explicitly list ONLY the commands you want to block

4. Restart the MCP server after changing the configuration (restart Claude Desktop or your MCP client)

**Prevention:**
- Review the [Default Configuration](#default-configuration) section to understand which commands are blocked by default
- Use the `validate_command` tool to test commands before running them
- Consider using alternative commands (e.g., `Remove-Item` in PowerShell instead of `rm`)

**Related Configuration:**
See [Security Settings](#security-settings) for details on `blockedCommands` and `blockedArguments`.

### Issue: "Path not allowed" or "Working directory outside allowed paths"

**Symptoms:**
- Command execution returns exit code `-2`
- Error message: "Working directory is outside allowed paths"
- Commands fail even though they seem safe

**Cause:**
You're trying to execute a command in a directory that's not in the `security.allowedPaths` list, and `security.restrictWorkingDirectory` is set to `true`.

**CRITICAL: Understanding Config Merge Behavior**

The server uses a **security-first merge strategy** for `allowedPaths`:

- **allowedPaths uses INTERSECTION** (not union!)
- Only paths that appear in BOTH the default config AND your custom config are allowed
- This prevents accidentally weakening security by adding overly broad paths

**Example of INCORRECT configuration:**
```json
// DEFAULT CONFIG (implicit):
// allowedPaths: ["C:\\Users\\YourName", "C:\\Development\\Projects\\MCP\\project-root"]

// YOUR CONFIG:
{
  "security": {
    "allowedPaths": ["C:\\MyProjects"]  // This will BLOCK everything!
  }
}

// RESULT: Intersection = [] (empty!)
// No paths are allowed because there's no overlap!
```

**Example of CORRECT configuration:**
```json
// DEFAULT CONFIG (implicit):
// allowedPaths: ["C:\\Users\\YourName", "C:\\Development\\Projects\\MCP\\project-root"]

// YOUR CONFIG:
{
  "security": {
    "allowedPaths": [
      "C:\\Users\\YourName",  // Keep defaults you want
      "C:\\Development\\Projects\\MCP\\project-root",  // Keep defaults you want
      "C:\\MyProjects"  // Add new paths
    ]
  }
}

// RESULT: All three paths are allowed
```

**Solution:**

1. Check which paths are currently allowed:
   ```json
   {
     "tool": "check_security_config",
     "arguments": {
       "category": "paths"
     }
   }
   ```

2. Identify your current working directory:
   ```json
   {
     "tool": "read_current_directory"
   }
   ```

3. Update your `config.json` to include BOTH the defaults AND your new paths:
   ```json
   {
     "security": {
       "allowedPaths": [
         "C:\\Users\\YourUsername",  // Include existing defaults!
         "C:\\Development\\Projects",  // Include existing defaults!
         "C:\\YourNewPath"  // Add your new path
       ],
       "restrictWorkingDirectory": true
     }
   }
   ```

4. **Alternative**: Disable path restrictions entirely (NOT recommended for security):
   ```json
   {
     "security": {
       "restrictWorkingDirectory": false
     }
   }
   ```

5. Restart the MCP server

**Prevention:**
- Always include existing allowed paths when adding new ones
- Use absolute paths (e.g., `C:\Users\Name` not `~` or relative paths)
- Test path validation before running important commands using `validate_command`
- Use forward slashes `/` or escaped backslashes `\\` in JSON config files

**Related Configuration:**
See [Security Settings](#security-settings) for details on `allowedPaths` and `restrictWorkingDirectory`.

### Issue: SSH Connection Failed

**Symptoms:**
- `ssh_execute` or `validate_ssh_connection` returns an error
- Error messages like "Connection refused", "Authentication failed", "Connection timeout", or "Host not found"
- SSH commands work from terminal but fail through MCP

**Common Causes:**

1. **Network/Firewall Issues:**
   - Firewall blocking port 22 (or custom SSH port)
   - Host is unreachable or hostname resolution fails
   - VPN required but not connected

2. **Authentication Issues:**
   - Incorrect username or password
   - Private key file not found or has wrong permissions
   - Private key requires passphrase (not supported)
   - SSH key not authorized on remote server

3. **Configuration Issues:**
   - Wrong hostname or IP address
   - Wrong port number
   - SSH not enabled in server config
   - Connection ID doesn't exist

**Solution:**

1. **Verify SSH is enabled in your config:**
   ```json
   {
     "ssh": {
       "enabled": true,  // Must be true!
       "connections": {
         // Your connections here
       }
     }
   }
   ```

2. **Test the SSH connection configuration:**
   ```json
   {
     "tool": "validate_ssh_connection",
     "arguments": {
       "connectionConfig": {
         "host": "your-server.example.com",
         "port": 22,
         "username": "your-username",
         "password": "your-password"  // Or use privateKeyPath
       }
     }
   }
   ```

3. **For authentication failures:**

   **Password authentication:**
   ```json
   {
     "ssh": {
       "enabled": true,
       "connections": {
         "my-server": {
           "host": "server.example.com",
           "port": 22,
           "username": "admin",
           "password": "your-password"  // Ensure password is correct
         }
       }
     }
   }
   ```

   **Key-based authentication:**
   ```json
   {
     "ssh": {
       "enabled": true,
       "connections": {
         "my-server": {
           "host": "server.example.com",
           "port": 22,
           "username": "admin",
           "privateKeyPath": "C:\\Users\\YourName\\.ssh\\id_rsa"  // Use full path
         }
       }
     }
   }
   ```

   **Important for key authentication:**
   - Ensure the private key file exists at the specified path
   - Private key must NOT require a passphrase (passphrase-protected keys are not supported)
   - Public key must be added to `~/.ssh/authorized_keys` on the remote server
   - Private key file permissions should be restrictive (read-only for owner)

4. **For connection timeouts:**
   - Increase timeout values in your config:
   ```json
   {
     "ssh": {
       "enabled": true,
       "readyTimeout": 30000,  // 30 seconds to establish connection
       "connections": {
         "my-server": {
           "host": "server.example.com",
           "port": 22,
           "username": "admin",
           "password": "your-password",
           "readyTimeout": 60000  // Override global timeout for this connection
         }
       }
     }
   }
   ```

5. **Check connection pool status:**
   ```json
   {
     "tool": "read_ssh_pool_status"
   }
   ```

6. **Test from command line first:**
   ```bash
   # Test if you can connect via standard SSH
   ssh username@server.example.com
   
   # Test specific port
   ssh -p 2222 username@server.example.com
   ```

7. **For "Host not found" errors:**
   - Use IP address instead of hostname if DNS resolution is failing
   - Verify hostname is correct and accessible from your network
   - Check if VPN connection is required

**Prevention:**
- Use `validate_ssh_connection` before adding connections to verify configuration
- Test SSH access from command line before configuring in MCP
- Use key-based authentication for better security (ensure keys don't require passphrase)
- Keep connection credentials up to date
- Monitor connection pool status if managing many SSH connections

**Related Configuration:**
See [SSH Configuration](#ssh-configuration) for details on SSH settings.

### Issue: Command Times Out

**Symptoms:**
- Command execution returns exit code `-1`
- Error message: "Command execution timed out"
- Long-running commands are killed before completion

**Cause:**
The command took longer than the configured `commandTimeout` (default: 30 seconds) to complete.

**Solution:**

1. **For individual commands**, override the timeout in the tool call:
   ```json
   {
     "tool": "execute_command",
     "arguments": {
       "shell": "powershell",
       "command": "your-long-running-command",
       "timeout": 120  // 120 seconds for this command only
     }
   }
   ```

2. **For all commands**, increase the default timeout in your `config.json`:
   ```json
   {
     "security": {
       "commandTimeout": 120  // 120 seconds default for all commands
     }
   }
   ```

3. **For SSH commands**, configure SSH-specific timeout:
   ```json
   {
     "ssh": {
       "enabled": true,
       "defaultTimeout": 120,  // 120 seconds for all SSH commands
       "connections": {
         "slow-server": {
           "host": "server.example.com",
           "port": 22,
           "username": "admin",
           "password": "password"
           // This connection will use the defaultTimeout of 120 seconds
         }
       }
     }
   }
   ```

4. Restart the MCP server after changing configuration

**Prevention:**
- Set appropriate timeout values for your use case
- Break long-running operations into smaller commands
- Use background jobs or scheduled tasks for very long operations
- Monitor command execution time using `read_command_history`

### Using Custom Environment Variables

You can pass custom environment variables to commands for encoding, locale, or other settings:

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

**Security notes:**
- Sensitive variables (AWS keys, passwords, tokens) are blocked by default
- PATH and LD_PRELOAD are blocked to prevent privilege escalation
- Use `check_security_config` with `"category": "environment"` to see blocked variables
- In allowlist mode, only explicitly allowed variables can be set

**Related Configuration:**
See [Security Settings](#security-settings) for `commandTimeout` and [SSH Configuration](#ssh-configuration) for `defaultTimeout`.

### Issue: Shell Operators Blocked (Pipes, Redirects, Command Chaining)

**Symptoms:**
- Command execution returns exit code `-2`
- Error message: "Command contains blocked operator: &" (or |, ;, >, <, etc.)
- Commands with pipes, redirects, or command chaining fail
- Error mentions Unicode variants or zero-width characters

**Cause:**
The server blocks shell operators (`&`, `|`, `;`, `` ` ``, `>`, `<`, `>>`, `2>`, `2>&1`) and their Unicode homoglyphs to prevent command injection attacks. This is a security feature enabled by default.

**Solution:**

1. **For PowerShell users**, use PowerShell cmdlets instead of pipes:
   ```powershell
   # Instead of: dir | findstr "test"
   # Use: Get-ChildItem | Where-Object { $_.Name -like "*test*" }
   
   # Instead of: command1 && command2
   # Use: command1; if ($?) { command2 }
   ```

2. **For simple output redirection**, capture output programmatically instead:
   - The MCP server already captures and returns stdout/stderr
   - Use `read_command_history` to review output from previous commands

3. **For complex operations**, break into multiple separate commands:
   ```json
   // Instead of one command with pipes:
   // "dir | findstr test > output.txt"
   
   // Execute as separate commands:
   // Command 1:
   {
     "tool": "execute_command",
     "arguments": {
       "shell": "powershell",
       "command": "Get-ChildItem | Where-Object { $_.Name -like '*test*' } | Out-String"
     }
   }
   // Then save the result programmatically if needed
   ```

4. **If you absolutely must use operators** (NOT recommended for security):

   You can modify blocked operators per shell in your `config.json`:
   ```json
   {
     "shells": {
       "powershell": {
         "enabled": true,
         "command": "powershell.exe",
         "args": ["-NoProfile", "-NonInteractive", "-Command"],
         "blockedOperators": [";", "`"]  // Only block some operators (RISKY!)
       }
     }
   }
   ```

   **Warning**: Removing operator blocks significantly increases security risk. Only do this if you fully understand the implications.

5. **Test before running:**
   ```json
   {
     "tool": "validate_command",
     "arguments": {
       "shell": "powershell",
       "command": "your-command-here"
     }
   }
   ```

**Prevention:**
- Use PowerShell cmdlets and native command features instead of shell operators
- Learn PowerShell piping syntax (`|`) which is safer within PowerShell context
- Break complex operations into multiple commands
- Understand that operator blocking is a critical security feature

**Related Configuration:**
See [Shell Configuration](#shell-configuration) for `blockedOperators` setting.

### Using Diagnostic Tools

The server provides built-in diagnostic tools to help troubleshoot issues:

#### validate_command - Test Commands Before Running

Validate a command without executing it to see if it would be blocked:

```json
{
  "tool": "validate_command",
  "arguments": {
    "shell": "powershell",
    "command": "Remove-Item test.txt",
    "workingDir": "C:\\MyProjects"  // Optional
  }
}
```

**Returns when valid:**
```json
{
  "valid": true,
  "shell": "powershell",
  "command": "Remove-Item test.txt",
  "workingDir": "C:\\MyProjects",
  "message": "Command passed all security validation stages"
}
```

**Returns when invalid:**
```json
{
  "valid": false,
  "shell": "powershell",
  "command": "rm -rf /",
  "workingDir": "C:\\MyProjects",
  "reason": "Command contains blocked command: rm"
}
```

**Use cases:**
- Test commands before running to avoid validation failures
- Debug why specific commands are being blocked
- Verify path and operator restrictions
- Check command length limits

#### check_security_config - Inspect Security Rules

View current security configuration to understand what's blocked:

```json
{
  "tool": "check_security_config",
  "arguments": {
    "category": "all"  // Options: "all", "commands", "paths", "operators", "limits"
  }
}
```

**Categories:**
- `"commands"`: Shows blocked commands and arguments
- `"paths"`: Shows allowed paths and directory restriction status
- `"operators"`: Shows blocked operators for each shell
- `"limits"`: Shows max command length and timeout settings
- `"all"`: Shows everything

**Use cases:**
- Understand which commands are blocked and why
- Verify allowed paths are configured correctly
- Check timeout and length limits
- Audit security configuration

#### read_command_history - Review Past Executions

Review command history to see exit codes and outputs:

```json
{
  "tool": "read_command_history",
  "arguments": {
    "limit": 10  // Number of recent commands to retrieve
  }
}
```

**Returns:**
Array of command history entries with:
- `command`: The command that was executed
- `timestamp`: When it was executed
- `output`: Combined stdout/stderr
- `exitCode`: Result code (0, -1, or -2)

**Use cases:**
- Track which commands succeeded or failed
- Identify patterns in command failures
- Review command outputs for debugging
- Monitor command execution over time

#### validate_ssh_connection - Test SSH Configuration

Test SSH connection configuration before using it:

```json
{
  "tool": "validate_ssh_connection",
  "arguments": {
    "connectionConfig": {
      "host": "server.example.com",
      "port": 22,
      "username": "admin",
      "password": "your-password"  // Or use privateKeyPath
    }
  }
}
```

**Returns:**
- `isValid`: Whether connection was successful
- `shellType`: Detected shell type on remote server (bash, zsh, powershell, fish, etc.)
- `error`: Error message if connection failed

**Use cases:**
- Test SSH credentials before adding to config
- Verify network connectivity to remote hosts
- Detect remote shell type for compatibility
- Debug SSH authentication issues

### Getting Help

If you're still experiencing issues after trying these solutions:

1. **Check the command history** to see exact error messages and exit codes
2. **Use diagnostic tools** to validate your configuration and commands
3. **Review the configuration merge behavior** - especially for `allowedPaths` (intersection) vs `blockedCommands` (union)
4. **Check the GitHub repository** for known issues and updates: https://github.com/quanticsoul4772/win-cli-mcp-server
5. **Report bugs** with:
   - Error messages and exit codes
   - Configuration file (sanitized - remove passwords!)
   - Steps to reproduce
   - Output from `check_security_config` diagnostic tool

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
