# Contributing to Windows CLI MCP Server

Thank you for your interest in contributing to the Windows CLI MCP Server! This project provides secure command-line interactions on Windows systems through the Model Context Protocol (MCP). We welcome contributions of all kinds, from bug reports and documentation improvements to new features and security enhancements.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Documentation Guidelines](#documentation-guidelines)
- [Security Considerations](#security-considerations)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Community and Support](#community-and-support)

## Code of Conduct

This project adheres to professional and respectful collaboration standards. By participating, you are expected to:

- Be respectful and inclusive in all interactions
- Provide constructive feedback and accept it gracefully
- Focus on what is best for the community and the project
- Show empathy towards other community members
- Avoid harassment, discriminatory language, or personal attacks

Unacceptable behavior should be reported to the project maintainers through GitHub issues or direct contact.

## How Can I Contribute?

There are many ways to contribute to this project:

### Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/quanticsoul4772/win-cli-mcp-server/issues) to avoid duplicates. When you create a bug report, include as many details as possible:

- **Clear, descriptive title** - Summarize the problem in the title
- **Steps to reproduce** - Provide specific steps to reproduce the behavior
- **Expected behavior** - Describe what you expected to happen
- **Actual behavior** - Describe what actually happened
- **Environment details** - Include OS version, Node.js version, package version
- **Configuration** - Share your config.json (remove sensitive data like passwords)
- **Error messages** - Include full error messages and stack traces
- **Screenshots** - If applicable, add screenshots to help explain the problem

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Clear, descriptive title** - Summarize the suggestion
- **Detailed description** - Explain the feature and why it would be useful
- **Use cases** - Provide specific examples of how the feature would be used
- **Alternatives considered** - Describe any alternative solutions or features you've considered
- **Additional context** - Add any other context, mockups, or examples

### Contributing Code

We welcome code contributions! Areas where contributions are especially valuable:

- **Security improvements** - Enhanced validation, additional security checks
- **Bug fixes** - Fixing reported issues or edge cases
- **New features** - Additional MCP tools, shell support, or functionality
- **Performance optimizations** - Improving execution speed or resource usage
- **Test coverage** - Adding tests for existing functionality
- **Documentation** - Improving README, API docs, or inline comments

### Improving Documentation

Documentation improvements are always welcome:

- Fix typos or clarify confusing explanations
- Add examples for configuration options
- Improve API documentation
- Create tutorials or guides
- Translate documentation (if applicable)

## Getting Started

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** (comes with Node.js)
- **Git** for version control
- **Windows OS** (required for full testing of Windows shells)
- **TypeScript** knowledge (for code contributions)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:

```bash
git clone https://github.com/YOUR-USERNAME/win-cli-mcp-server.git
cd win-cli-mcp-server
```

3. Add the upstream repository as a remote:

```bash
git remote add upstream https://github.com/quanticsoul4772/win-cli-mcp-server.git
```

## Development Setup

### Installation

1. Install dependencies:

```bash
npm install
```

2. Build the project:

```bash
npm run build
```

3. Create a configuration file for testing:

```bash
npm start -- --init-config ./config.json
```

Edit `config.json` to configure security settings and test environments.

### Development Workflow

1. **Watch mode** - For active development with automatic recompilation:

```bash
npm run watch
```

2. **Run tests** - Always run tests before committing:

```bash
npm test
```

3. **Test with watch mode** - For test-driven development:

```bash
npm run test:watch
```

4. **Check test coverage** - Ensure new code is well-tested:

```bash
npm run test:coverage
```

5. **Run the server locally** - Test your changes:

```bash
npm start
# or with custom config
npm start -- --config ./config.json
```

### Project Structure

```
win-cli-mcp-server/
├── src/
│   ├── index.ts           # Main server entry point
│   ├── types/             # TypeScript type definitions
│   │   ├── config.ts      # Configuration types
│   │   └── schemas.ts     # Zod validation schemas
│   └── utils/             # Utility functions
│       ├── config.ts      # Configuration management
│       ├── deepMerge.ts   # Secure configuration merging
│       ├── validation.ts  # Security validation functions
│       ├── ssh.ts         # SSH connection management
│       ├── sshManager.ts  # SSH configuration CRUD
│       └── sessionManager.ts # Session state management
├── tests/                 # Test files
│   └── validation.test.ts # Validation function tests
├── dist/                  # Compiled JavaScript (generated)
├── CLAUDE.md              # AI assistant development guide
├── README.md              # User documentation
└── package.json           # Project configuration
```

## Pull Request Process

### Before Submitting

1. **Create a feature branch** from `main`:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

2. **Make your changes** following the [coding standards](#coding-standards)

3. **Add tests** for new functionality or bug fixes

4. **Run all tests** and ensure they pass:

```bash
npm test
```

5. **Update documentation** if you've changed functionality

6. **Commit your changes** following the [commit message guidelines](#commit-message-guidelines)

### Submitting a Pull Request

1. **Push to your fork**:

```bash
git push origin feature/your-feature-name
```

2. **Open a Pull Request** on GitHub with:
   - **Clear title** - Summarize the changes
   - **Description** - Explain what changed and why
   - **Related issues** - Link to any related issues (e.g., "Fixes #123")
   - **Breaking changes** - Note any breaking changes
   - **Testing** - Describe how you tested the changes
   - **Screenshots** - If applicable, add screenshots

3. **Respond to feedback** - Address review comments promptly

4. **Keep your PR updated** - Rebase if needed to resolve conflicts:

```bash
git fetch upstream
git rebase upstream/main
git push --force-with-lease origin feature/your-feature-name
```

### Pull Request Review Process

- Maintainers will review your PR and may request changes
- All tests must pass before merging
- At least one maintainer approval is required
- Security-related changes require extra scrutiny
- Once approved, a maintainer will merge your PR

## Coding Standards

### TypeScript Guidelines

- **Use strict TypeScript** - The project uses `strict: true` in tsconfig.json
- **Type everything explicitly** - Avoid `any` unless absolutely necessary
- **Use interfaces/types** - Define types for all data structures
- **Follow existing patterns** - Match the style of surrounding code
- **ES2020 features** - Use modern JavaScript features (async/await, optional chaining, etc.)

### Code Style

- **Indentation** - 2 spaces (no tabs)
- **Line length** - Keep lines under 100 characters when practical
- **Naming conventions**:
  - `camelCase` for variables and functions
  - `PascalCase` for classes and interfaces
  - `UPPER_SNAKE_CASE` for constants
- **Comments** - Write clear comments for complex logic
- **Error handling** - Always handle errors appropriately
  - Use try/catch for async operations
  - Sanitize error messages (never expose sensitive paths or data)
  - Return appropriate exit codes (-1 for execution errors, -2 for validation errors)

### Security-First Development

This project prioritizes security. When contributing:

- **Fail-closed validation** - Default to denying unsafe operations
- **Defense in depth** - Multiple layers of validation are better than one
- **No trust in input** - Validate all user input thoroughly
- **Sanitize errors** - Never expose internal paths or sensitive configuration
- **Test security features** - Include tests for security validations
- **Document security implications** - Note any security considerations in PR description

### Key Security Patterns

1. **Command validation** - Use the existing validation pipeline in `validateCommand()`
2. **Path canonicalization** - Always use `canonicalizePath()` before path comparisons
3. **Configuration merging** - Use `secureDeepMerge()` for security-critical settings
4. **Error messages** - Use generic messages, never expose internal details

## Testing Requirements

### Writing Tests

- **Test files** - Co-locate tests with source files or place in `tests/` directory
- **Naming** - Use `.test.ts` suffix for test files
- **Framework** - Use Jest with TypeScript support
- **Coverage** - Aim for >80% code coverage for new code

### Test Structure

```typescript
import { describe, it, expect } from '@jest/globals';
import { yourFunction } from '../src/utils/yourModule.js';

describe('yourFunction', () => {
  it('should handle valid input correctly', () => {
    const result = yourFunction('valid input');
    expect(result).toBe(expected);
  });

  it('should reject invalid input', () => {
    expect(() => yourFunction('invalid')).toThrow('Expected error message');
  });

  it('should handle edge cases', () => {
    // Test edge cases
  });
});
```

### Testing Checklist

- [ ] All new functions have unit tests
- [ ] Edge cases are tested (empty strings, null, undefined, special characters)
- [ ] Error conditions are tested
- [ ] Security validations are tested with malicious inputs
- [ ] All tests pass locally before submitting PR
- [ ] Test coverage hasn't decreased

### Running Tests

```bash
# Run all tests
npm test

# Watch mode (for TDD)
npm run test:watch

# Coverage report
npm run test:coverage
```

## Documentation Guidelines

### Code Documentation

- **JSDoc comments** - Add JSDoc for all exported functions and classes:

```typescript
/**
 * Validates a command against security rules
 * @param command - The command string to validate
 * @param config - Security configuration
 * @returns Parsed command if valid
 * @throws Error if command violates security rules
 */
export function validateCommand(command: string, config: SecurityConfig): ParsedCommand {
  // Implementation
}
```

- **Inline comments** - Explain complex logic or non-obvious decisions
- **Type definitions** - Document complex types with comments

### README Updates

- Update README.md if you've added new features or changed functionality
- Add examples for new tools or configuration options
- Keep the API section up-to-date with new tools or resources

### CLAUDE.md Updates

- Update CLAUDE.md for significant architectural changes
- Document new patterns or implementation details
- Add notes about new security considerations

## Security Considerations

### Reporting Security Vulnerabilities

**DO NOT** open a public issue for security vulnerabilities. Instead:

1. **Email the maintainers** or use GitHub's private security advisory feature
2. **Provide detailed information** about the vulnerability
3. **Include steps to reproduce** if applicable
4. **Suggest a fix** if you have one

We will acknowledge your report within 48 hours and work with you to address the issue.

### Security-Related Contributions

When contributing security improvements:

- **Explain the threat model** - What attack does this prevent?
- **Provide examples** - Show how the vulnerability could be exploited
- **Test thoroughly** - Include tests that demonstrate the fix
- **Document the change** - Update security documentation
- **Consider backwards compatibility** - Security fixes may require breaking changes

### Security Review Areas

Security-related changes require extra scrutiny in these areas:

- Command validation and parsing
- Path canonicalization and validation
- SSH connection management
- Configuration merging logic
- Error message sanitization
- Input handling and escaping

## Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) for clear, structured commit history.

### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

- **feat** - A new feature
- **fix** - A bug fix
- **docs** - Documentation only changes
- **style** - Code style changes (formatting, missing semicolons, etc.)
- **refactor** - Code change that neither fixes a bug nor adds a feature
- **perf** - Performance improvements
- **test** - Adding or updating tests
- **chore** - Maintenance tasks (dependencies, build config, etc.)
- **security** - Security improvements or fixes

### Examples

```
feat: add support for Bash shell on Linux

This commit adds basic support for executing commands in Bash on Linux
systems, expanding beyond Windows-only operation.

Closes #45
```

```
fix: prevent command injection via Unicode homoglyphs

Added detection for Unicode characters that look like shell operators
(e.g., ｜ for |) to prevent bypass of operator blocking.

BREAKING CHANGE: Commands containing Unicode homoglyphs will now be rejected
```

```
docs: clarify SSH configuration examples in README

Added more detailed examples for SSH key-based authentication and
explained the keepalive settings.
```

```
test: add tests for path canonicalization edge cases

Covers symlinks, junctions, and relative paths to ensure TOCTOU
protection works correctly.
```

### Breaking Changes

If your change introduces a breaking change:

- Add `BREAKING CHANGE:` in the commit footer
- Explain what broke and how to migrate
- Consider bumping the major version

## Community and Support

### Getting Help

- **GitHub Issues** - For bug reports and feature requests
- **Discussions** - For questions and general discussion (if enabled)
- **Documentation** - Check README.md and CLAUDE.md for detailed information

### Recognition

Contributors will be recognized in:

- GitHub contributors list
- Release notes for significant contributions
- Project documentation (if applicable)

### License

By contributing to this project, you agree that your contributions will be licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

Thank you for contributing to the Windows CLI MCP Server! Your efforts help make this project more secure, reliable, and useful for everyone.
