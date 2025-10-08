# Security Policy

## Overview

The security of the Windows CLI MCP Server is a top priority. This server provides controlled command-line access to Windows systems and remote servers via SSH, and we take security vulnerabilities seriously. This document outlines our security policy, including how to report vulnerabilities and what to expect during the disclosure process.

## Supported Versions

We actively provide security updates for the following versions:

| Version | Supported          | Status |
| ------- | ------------------ | ------ |
| 0.3.x   | :white_check_mark: | Active development with ongoing security improvements |
| 0.2.x   | :warning:          | Critical security fixes only |
| < 0.2.0 | :x:                | No longer supported - please upgrade |

**Recommendation:** Always use the latest version to benefit from the most recent security enhancements and fixes.

## Security Features

This server implements defense-in-depth security through multiple layers:

### Built-in Security Controls

- **Multi-stage Command Validation Pipeline**: All commands pass through 6 validation layers before execution
- **Shell Operator Blocking**: Prevents command chaining (`&`, `|`, `;`, `` ` ``) and redirection (`>`, `<`, `>>`, `2>`, `2>&1`)
- **Unicode Homoglyph Detection**: Blocks Unicode variants of dangerous operators (｜, ；, ＆)
- **Command Blocking**: Case-insensitive blocking of dangerous commands with all extension variants
- **Path Canonicalization**: TOCTOU protection through symlink/junction resolution
- **Working Directory Restrictions**: Enforces allowed paths using canonical path comparison
- **Argument Validation**: Independent argument checking against blocked patterns
- **Length Limits**: Configurable maximum command length (default: 2000 characters)
- **Null Byte & Control Character Detection**: Blocks dangerous characters in commands
- **Timeout Enforcement**: Prevents runaway processes (default: 30 seconds)
- **Audit Logging**: Comprehensive command history with timestamps and exit codes
- **SSH Connection Pooling**: LRU eviction, idle timeouts, automatic cleanup
- **Error Sanitization**: Prevents disclosure of internal paths and sensitive configuration

### Fail-Secure Defaults

The server uses a **fail-closed** security model:
- All validation rules default to restrictive settings
- Configuration merging preserves the most restrictive values
- Blocked command/argument lists are combined (union) during merge
- Allowed paths use intersection during merge (both must allow)
- Unknown configurations fall back to secure defaults

### Exit Code System

- **0**: Success
- **-1**: Execution failure (command ran but failed, timeout, or process error)
- **-2**: Validation failure (blocked by security rules before execution)

Exit codes allow auditing to distinguish between security blocks and runtime failures.

## Reporting a Vulnerability

We appreciate the security research community's efforts in identifying and responsibly disclosing security issues. If you discover a security vulnerability, please follow these guidelines:

### How to Report

**Primary Contact:** Email security reports to **rbsmith4@gmail.com**

**Subject Line Format:** `[SECURITY] Brief description of vulnerability`

**What to Include:**

1. **Description**: Clear description of the vulnerability and its potential impact
2. **Affected Versions**: Which versions of the server are affected
3. **Reproduction Steps**: Detailed steps to reproduce the vulnerability
4. **Proof of Concept**: Code, configuration, or commands demonstrating the issue (if applicable)
5. **Suggested Fix**: If you have ideas for remediation (optional but appreciated)
6. **Disclosure Timeline**: Any constraints on your disclosure timeline
7. **Credit Preference**: How you would like to be credited (name, handle, organization, or anonymous)

### What to Expect

1. **Acknowledgment**: We will acknowledge receipt of your report within **48 hours**
2. **Initial Assessment**: We will provide an initial assessment of the report within **5 business days**
3. **Regular Updates**: We will keep you informed of our progress at least every **7 days**
4. **Validation**: We will work to validate and reproduce the reported vulnerability
5. **Remediation**: We will develop, test, and release a fix
6. **Disclosure**: We will coordinate public disclosure with you

### Our Commitments

- We will not pursue legal action against security researchers who:
  - Act in good faith
  - Follow this responsible disclosure process
  - Avoid privacy violations, data destruction, or service disruption
  - Make reasonable efforts to avoid impacting users
- We will credit researchers in security advisories (unless anonymity is requested)
- We will keep you informed throughout the remediation process

## Coordinated Vulnerability Disclosure

We follow industry-standard coordinated vulnerability disclosure (CVD) practices:

### Disclosure Timeline

- **Day 0**: Vulnerability reported
- **Day 2**: Acknowledgment sent (within 48 hours)
- **Day 7**: Initial assessment provided (within 5 business days)
- **Target: 30 days**: Fix developed and tested
- **Target: 45 days**: Fixed version released
- **Target: 60 days**: Public disclosure (coordinated with reporter)

For critical vulnerabilities affecting active users:
- **Expedited timeline**: 7-14 days to release
- **Early notification**: We may notify major users before public disclosure
- **Public advisory**: Released on the same day as the fix

### Flexibility

We understand that each vulnerability is unique. If you need to disclose on a different timeline:
- Contact us as early as possible
- We will work with you to find a mutually agreeable schedule
- For zero-day exploits being actively exploited, we will prioritize immediate remediation

### Public Disclosure

Once a fix is available and sufficient time has passed for users to update:
- We will publish a security advisory in the GitHub Security Advisories section
- The advisory will include CVE identifier (if applicable), affected versions, and remediation steps
- We will credit the reporter unless anonymity is requested
- We will update this SECURITY.md with any new security recommendations

## Security Advisories

Security advisories will be published at:
- **GitHub Security Advisories**: https://github.com/quanticsoul4772/win-cli-mcp-server/security/advisories
- **npm Package Page**: https://www.npmjs.com/package/@simonb97/server-win-cli

We recommend:
- Subscribing to the GitHub repository to receive security notifications
- Monitoring the npm package page for security advisories
- Enabling GitHub Dependabot alerts if you depend on this package

## Known Security Considerations

### Current Limitations

1. **Command Execution**: This server provides controlled but direct command execution. Even with validation, commands can:
   - Read files within allowed paths
   - Execute allowed commands that may have unintended side effects
   - Access environment variables visible to the server process

2. **SSH Connections**: SSH functionality provides access to remote systems. Consider:
   - Storing SSH credentials in the configuration file (use restrictive file permissions)
   - The server maintains persistent SSH connections (connection pool)
   - Remote shell detection is fail-closed but may not detect all shell types

3. **Configuration File Security**: The configuration file may contain sensitive information:
   - SSH passwords and private key paths
   - Allowed paths revealing directory structure
   - Always use restrictive file permissions (Windows: use NTFS permissions)

### Best Practices for Users

1. **Restrict Allowed Paths**: Use the most restrictive `allowedPaths` possible for your use case
2. **Enable Directory Restrictions**: Set `restrictWorkingDirectory: true` (default)
3. **Review Blocked Commands**: Extend `blockedCommands` and `blockedArguments` as needed for your environment
4. **Enable Command Logging**: Keep `logCommands: true` (default) for audit trails
5. **Secure Configuration Files**: Protect config files with appropriate permissions
6. **Regular Updates**: Keep the server updated to the latest version
7. **Principle of Least Privilege**: Only enable shells and SSH connections you actively use
8. **Review Command History**: Periodically review command history for unexpected activity
9. **Timeout Configuration**: Use appropriate `commandTimeout` values to prevent resource exhaustion
10. **SSH Key Authentication**: Prefer SSH key authentication over passwords when possible

## Security Contact

For security-related questions or concerns that are not vulnerability reports:
- **Email**: rbsmith4@gmail.com
- **GitHub Issues**: https://github.com/quanticsoul4772/win-cli-mcp-server/issues (for non-sensitive discussions)

For general support and feature requests, please use GitHub Issues. Reserve the security email for security-sensitive matters.

## Scope

This security policy covers:
- The `@simonb97/server-win-cli` npm package
- Source code in the https://github.com/quanticsoul4772/win-cli-mcp-server repository
- Official documentation and configuration examples

This policy does not cover:
- Third-party MCP clients using this server
- Third-party forks or modifications
- Dependencies (report to their respective maintainers)
- Issues in shells, SSH, or operating systems (report to those projects)

## Recognition

We believe in recognizing the valuable contributions of security researchers. Researchers who report valid security vulnerabilities will be:
- Credited in security advisories (unless anonymity is requested)
- Listed in our security acknowledgments (with permission)
- Considered for bounties or rewards (on a case-by-case basis for critical findings)

Thank you for helping keep the Windows CLI MCP Server and its users safe!

---

**Last Updated**: 2025-10-08
**Version**: 0.3.0
