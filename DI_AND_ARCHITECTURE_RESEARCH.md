# Dependency Injection and Architecture Patterns Research

## Executive Summary

This document provides research findings and recommendations for refactoring the win-cli-mcp-server project to improve maintainability, testability, and scalability. The focus is on lightweight, pragmatic solutions that work well with ES modules and avoid heavy framework dependencies.

**Key Recommendations:**
1. **DI Approach**: Use manual constructor injection with a simple service container (no decorators)
2. **Tool Registry**: Implement a type-safe registry pattern for tool handlers
3. **Project Structure**: Adopt a layered architecture with clear separation of concerns
4. **Refactoring Strategy**: Incremental migration starting with new code

---

## 1. Dependency Injection Approaches

### 1.1 Recommended Approach: Manual Constructor Injection + Simple Container

For this project, **manual constructor injection** with a lightweight service container is recommended over decorator-based frameworks.

**Rationale:**
- Works seamlessly with ES modules (`.js` imports)
- No runtime decorator metadata (`reflect-metadata`) required
- Minimal dependencies
- Better performance and smaller bundle size
- More explicit and easier to debug
- Compatible with strict TypeScript settings

### 1.2 Simple DI Container Implementation

Here's a lightweight, type-safe DI container implementation:

```typescript
// src/core/Container.ts

type Constructor<T = any> = new (...args: any[]) => T;
type Factory<T = any> = () => T;
type ServiceKey = string | symbol;

interface ServiceDefinition<T = any> {
  factory?: Factory<T>;
  instance?: T;
  singleton?: boolean;
  constructor?: Constructor<T>;
}

export class Container {
  private services = new Map<ServiceKey, ServiceDefinition>();
  private instances = new Map<ServiceKey, any>();

  /**
   * Register a singleton service
   */
  registerSingleton<T>(key: ServiceKey, factory: Factory<T> | Constructor<T>): this {
    this.services.set(key, {
      factory: typeof factory === 'function' && factory.prototype === undefined
        ? factory as Factory<T>
        : undefined,
      constructor: typeof factory === 'function' && factory.prototype !== undefined
        ? factory as Constructor<T>
        : undefined,
      singleton: true,
    });
    return this;
  }

  /**
   * Register a transient service (new instance each time)
   */
  registerTransient<T>(key: ServiceKey, factory: Factory<T> | Constructor<T>): this {
    this.services.set(key, {
      factory: typeof factory === 'function' && factory.prototype === undefined
        ? factory as Factory<T>
        : undefined,
      constructor: typeof factory === 'function' && factory.prototype !== undefined
        ? factory as Constructor<T>
        : undefined,
      singleton: false,
    });
    return this;
  }

  /**
   * Register an existing instance
   */
  registerInstance<T>(key: ServiceKey, instance: T): this {
    this.services.set(key, { instance });
    this.instances.set(key, instance);
    return this;
  }

  /**
   * Get a service by key
   */
  get<T>(key: ServiceKey): T {
    // Check if already instantiated (singleton)
    if (this.instances.has(key)) {
      return this.instances.get(key) as T;
    }

    const definition = this.services.get(key);
    if (!definition) {
      throw new Error(`Service not registered: ${String(key)}`);
    }

    // If instance is already provided
    if (definition.instance !== undefined) {
      return definition.instance as T;
    }

    // Create new instance
    let instance: T;
    if (definition.factory) {
      instance = definition.factory();
    } else if (definition.constructor) {
      instance = new definition.constructor();
    } else {
      throw new Error(`Cannot create instance for: ${String(key)}`);
    }

    // Cache if singleton
    if (definition.singleton) {
      this.instances.set(key, instance);
    }

    return instance;
  }

  /**
   * Check if service is registered
   */
  has(key: ServiceKey): boolean {
    return this.services.has(key);
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear(): void {
    this.services.clear();
    this.instances.clear();
  }
}
```

### 1.3 Usage Example

```typescript
// src/services/ConfigService.ts
export class ConfigService {
  constructor(private configPath: string) {}

  loadConfig() {
    // Implementation
  }
}

// src/services/SSHService.ts
export class SSHService {
  constructor(private config: ConfigService) {}

  connect() {
    const cfg = this.config.loadConfig();
    // Implementation
  }
}

// src/bootstrap.ts
import { Container } from './core/Container.js';

export function createContainer(): Container {
  const container = new Container();

  // Register services
  container.registerSingleton('config', () => new ConfigService('./config.json'));

  container.registerSingleton('ssh', () =>
    new SSHService(container.get('config'))
  );

  return container;
}

// src/index.ts
import { createContainer } from './bootstrap.js';

const container = createContainer();
const sshService = container.get<SSHService>('ssh');
```

### 1.4 Type-Safe Service Keys

For better type safety, use TypeScript's symbol-based approach:

```typescript
// src/core/ServiceKeys.ts
export const ServiceKeys = {
  Config: Symbol('Config'),
  SSH: Symbol('SSH'),
  Validation: Symbol('Validation'),
  CommandExecutor: Symbol('CommandExecutor'),
} as const;

// Usage with type inference
export interface ServiceMap {
  [ServiceKeys.Config]: ConfigService;
  [ServiceKeys.SSH]: SSHService;
  [ServiceKeys.Validation]: ValidationService;
  [ServiceKeys.CommandExecutor]: CommandExecutor;
}

// Enhanced Container with type safety
export class TypedContainer extends Container {
  get<K extends keyof ServiceMap>(key: K): ServiceMap[K] {
    return super.get(key);
  }
}
```

---

## 2. Tool Registry Pattern

### 2.1 Registry Pattern Overview

The **Registry Pattern** provides a centralized, type-safe mechanism for registering and retrieving tools/handlers dynamically. This pattern is particularly useful for:

- Scaling large codebases (proven to work with 1M+ lines of TypeScript)
- Enabling modular tool organization
- Improving code traceability
- Supporting lazy loading
- Reducing type checking complexity

**Source:** [Slash Engineering - Scaling 1M Lines of TypeScript](https://puzzles.slash.com/blog/scaling-1m-lines-of-typescript-registries)

### 2.2 Tool Registry Implementation

```typescript
// src/core/ToolRegistry.ts

import { z } from 'zod';

// Tool handler interface
export interface ToolHandler<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput) => Promise<TOutput>;
}

// Discriminator symbol for type safety
export const TOOL_HANDLER_SYMBOL = Symbol.for('ToolHandler');

export interface RegisterableToolHandler extends ToolHandler {
  $discriminator: typeof TOOL_HANDLER_SYMBOL;
}

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>();

  /**
   * Register a tool handler
   */
  register<TInput, TOutput>(tool: ToolHandler<TInput, TOutput>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool handler by name
   */
  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  /**
   * Get a tool handler (throws if not found)
   */
  getOrThrow(name: string): ToolHandler {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool;
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tool names
   */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get all tool handlers
   */
  getAllTools(): ToolHandler[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool by name
   */
  async execute<TInput, TOutput>(
    name: string,
    input: TInput
  ): Promise<TOutput> {
    const tool = this.getOrThrow(name);

    // Validate input
    const validated = tool.inputSchema.parse(input);

    // Execute handler
    return tool.handler(validated) as Promise<TOutput>;
  }
}
```

### 2.3 Tool Handler Definition Example

```typescript
// src/tools/ExecuteCommandTool.ts

import { z } from 'zod';
import { ToolHandler, TOOL_HANDLER_SYMBOL } from '../core/ToolRegistry.js';

const ExecuteCommandInputSchema = z.object({
  shell: z.enum(['powershell', 'cmd', 'gitbash']),
  command: z.string(),
  workingDir: z.string().optional(),
  timeout: z.number().optional(),
});

type ExecuteCommandInput = z.infer<typeof ExecuteCommandInputSchema>;

export const executeCommandTool: ToolHandler<ExecuteCommandInput, string> = {
  $discriminator: TOOL_HANDLER_SYMBOL,
  name: 'execute_command',
  description: 'Execute a command in the specified shell',
  inputSchema: ExecuteCommandInputSchema,

  async handler(input) {
    // Validation logic
    // Execution logic
    // Return result
    return 'Command executed';
  },
};
```

### 2.4 Auto-Registration Pattern

For automatic tool discovery, use a file naming convention:

```typescript
// src/core/ToolLoader.ts

import { glob } from 'glob';
import { pathToFileURL } from 'url';
import { ToolRegistry, TOOL_HANDLER_SYMBOL } from './ToolRegistry.js';

export async function loadToolsFromDirectory(
  registry: ToolRegistry,
  directory: string
): Promise<void> {
  // Find all .tool.ts or .tool.js files
  const toolFiles = await glob(`${directory}/**/*.tool.{ts,js}`);

  for (const filePath of toolFiles) {
    const fileUrl = pathToFileURL(filePath).href;
    const module = await import(fileUrl);

    // Look for exports with the discriminator symbol
    for (const exported of Object.values(module)) {
      if (
        typeof exported === 'object' &&
        exported !== null &&
        '$discriminator' in exported &&
        exported.$discriminator === TOOL_HANDLER_SYMBOL
      ) {
        registry.register(exported);
      }
    }
  }
}
```

### 2.5 Usage in MCP Server

```typescript
// src/index.ts

import { ToolRegistry } from './core/ToolRegistry.js';
import { loadToolsFromDirectory } from './core/ToolLoader.js';

class CLIServer {
  private toolRegistry: ToolRegistry;

  async initialize() {
    this.toolRegistry = new ToolRegistry();

    // Auto-load all tools
    await loadToolsFromDirectory(this.toolRegistry, './src/tools');

    console.error(`Loaded ${this.toolRegistry.listTools().length} tools`);
  }

  // MCP handler
  async handleCallTool(request: any) {
    const { name, arguments: args } = request.params;

    try {
      const result = await this.toolRegistry.execute(name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Tool execution failed: ${error.message}`
      );
    }
  }

  // MCP handler
  async handleListTools() {
    return {
      tools: this.toolRegistry.getAllTools().map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema),
      })),
    };
  }
}
```

---

## 3. Project Structure Recommendations

### 3.1 Recommended Folder Structure

For a 1000+ line TypeScript project, use a layered architecture with clear domain boundaries:

```
server-win-cli/
├── src/
│   ├── core/                      # Core abstractions and utilities
│   │   ├── Container.ts           # DI container
│   │   ├── ToolRegistry.ts        # Tool registry
│   │   ├── ToolLoader.ts          # Auto-loading tools
│   │   └── ServiceKeys.ts         # Service key definitions
│   │
│   ├── domain/                    # Domain layer (business logic)
│   │   ├── models/                # Domain models
│   │   │   ├── Command.ts
│   │   │   ├── ShellConfig.ts
│   │   │   └── ValidationResult.ts
│   │   ├── interfaces/            # Domain interfaces (ports)
│   │   │   ├── ICommandExecutor.ts
│   │   │   ├── IValidator.ts
│   │   │   └── ISSHManager.ts
│   │   └── services/              # Domain services
│   │       ├── ValidationService.ts
│   │       └── SecurityService.ts
│   │
│   ├── infrastructure/            # Infrastructure layer (implementations)
│   │   ├── config/
│   │   │   ├── ConfigLoader.ts
│   │   │   └── ConfigMerger.ts
│   │   ├── execution/
│   │   │   ├── CommandExecutor.ts
│   │   │   └── ProcessManager.ts
│   │   ├── ssh/
│   │   │   ├── SSHConnection.ts
│   │   │   ├── SSHConnectionPool.ts
│   │   │   └── SSHManager.ts
│   │   └── history/
│   │       └── CommandHistory.ts
│   │
│   ├── tools/                     # MCP tool handlers
│   │   ├── execute-command.tool.ts
│   │   ├── ssh-execute.tool.ts
│   │   ├── validate-command.tool.ts
│   │   └── index.ts
│   │
│   ├── resources/                 # MCP resource providers
│   │   ├── config.resource.ts
│   │   └── ssh-config.resource.ts
│   │
│   ├── utils/                     # Shared utilities
│   │   ├── validation.ts
│   │   ├── canonicalizePath.ts
│   │   └── deepMerge.ts
│   │
│   ├── types/                     # Shared type definitions
│   │   ├── config.ts
│   │   ├── schemas.ts
│   │   └── errors.ts
│   │
│   ├── bootstrap.ts               # Container setup and initialization
│   └── index.ts                   # Main entry point
│
├── __tests__/                     # Tests mirror src structure
│   ├── core/
│   ├── domain/
│   ├── infrastructure/
│   ├── tools/
│   └── integration/
│
├── config.json                    # Default configuration
├── tsconfig.json
├── package.json
└── README.md
```

### 3.2 Layered Architecture Principles

Based on Clean Architecture and Hexagonal Architecture patterns:

#### **Layer 1: Domain Layer** (`src/domain/`)
- Contains business logic and rules
- **Zero dependencies** on external frameworks or libraries (except standard Node.js)
- Defines interfaces (ports) that infrastructure will implement
- Pure TypeScript, highly testable

```typescript
// src/domain/interfaces/IValidator.ts
export interface IValidator {
  validateCommand(command: string, shell: string): Promise<ValidationResult>;
}

// src/domain/services/SecurityService.ts
export class SecurityService {
  constructor(private validator: IValidator) {}

  async isCommandSafe(cmd: string): Promise<boolean> {
    const result = await this.validator.validateCommand(cmd, 'powershell');
    return result.isValid;
  }
}
```

#### **Layer 2: Infrastructure Layer** (`src/infrastructure/`)
- Implements domain interfaces
- Contains concrete implementations
- Handles external dependencies (SSH, file system, process execution)
- Can depend on domain layer

```typescript
// src/infrastructure/execution/CommandExecutor.ts
import { ICommandExecutor } from '../../domain/interfaces/ICommandExecutor.js';

export class CommandExecutor implements ICommandExecutor {
  async execute(cmd: string): Promise<ExecutionResult> {
    // Concrete implementation using child_process
  }
}
```

#### **Layer 3: Application Layer** (`src/tools/`, `src/resources/`)
- Orchestrates use cases
- MCP tool and resource handlers
- Thin layer that delegates to domain/infrastructure

```typescript
// src/tools/execute-command.tool.ts
export const executeCommandTool: ToolHandler = {
  name: 'execute_command',
  async handler(input) {
    const validator = container.get('validator');
    const executor = container.get('executor');

    await validator.validateCommand(input.command);
    return executor.execute(input.command);
  },
};
```

#### **Layer 4: Core/Framework** (`src/core/`)
- Framework-level abstractions
- DI container, registries, loaders
- Shared across all layers

### 3.3 Dependency Flow

```
┌─────────────────┐
│   Application   │  MCP Tools, Resources
│   (tools/)      │
└────────┬────────┘
         │
         ↓
┌────────────────────────────────┐
│   Domain Layer                 │
│   (domain/)                    │
│   • Business Logic             │
│   • Interfaces (Ports)         │
│   • Domain Services            │
└────────┬───────────────────────┘
         ↑
         │ implements
         │
┌────────┴───────────────────────┐
│   Infrastructure Layer         │
│   (infrastructure/)            │
│   • Concrete Implementations   │
│   • External Dependencies      │
│   • Adapters                   │
└────────────────────────────────┘
```

**Key Rule:** Dependencies point **inward**. Domain layer has no outward dependencies.

---

## 4. MCP Server Architecture Patterns

### 4.1 Common MCP Server Patterns

Based on research from the official MCP repositories and community implementations:

#### Pattern 1: Tool-Centric Architecture
- Each tool is a self-contained unit
- Tools register themselves with the server
- Minimal shared state between tools

#### Pattern 2: Service-Oriented Architecture
- Tools delegate to shared services
- Services handle cross-cutting concerns (validation, logging, auth)
- Better code reuse and testability

#### Pattern 3: Layered Architecture (Recommended for this project)
- Clear separation between MCP protocol layer and business logic
- Domain services independent of MCP protocol
- Easy to test and maintain

### 4.2 MCP Server Structure

```typescript
// src/index.ts - Main MCP Server

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createContainer } from './bootstrap.js';
import { ToolRegistry } from './core/ToolRegistry.js';
import { loadToolsFromDirectory } from './core/ToolLoader.js';

export class CLIServer {
  private server: Server;
  private container: Container;
  private toolRegistry: ToolRegistry;

  async initialize() {
    // Setup DI container
    this.container = createContainer();

    // Setup tool registry
    this.toolRegistry = this.container.get<ToolRegistry>('toolRegistry');
    await loadToolsFromDirectory(this.toolRegistry, './src/tools');

    // Setup MCP server
    this.server = new Server(
      { name: 'win-cli-mcp-server', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } }
    );

    // Register MCP handlers
    this.setupHandlers();
  }

  private setupHandlers() {
    // List tools
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      async () => ({
        tools: this.toolRegistry.getAllTools().map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: zodToJsonSchema(tool.inputSchema),
        })),
      })
    );

    // Call tool
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const { name, arguments: args } = request.params;
        const result = await this.toolRegistry.execute(name, args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
    );
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Bootstrap
const server = new CLIServer();
await server.initialize();
await server.run();
```

### 4.3 Bootstrap Configuration

```typescript
// src/bootstrap.ts - Dependency Injection Setup

import { Container } from './core/Container.js';
import { ToolRegistry } from './core/ToolRegistry.js';
import { ConfigService } from './infrastructure/config/ConfigService.js';
import { ValidationService } from './domain/services/ValidationService.js';
import { CommandExecutor } from './infrastructure/execution/CommandExecutor.js';
import { SSHManager } from './infrastructure/ssh/SSHManager.js';

export function createContainer(): Container {
  const container = new Container();

  // Core services
  container.registerSingleton('toolRegistry', () => new ToolRegistry());

  // Configuration
  container.registerSingleton('config', () => new ConfigService());

  // Domain services
  container.registerSingleton('validation', () =>
    new ValidationService(container.get('config'))
  );

  // Infrastructure services
  container.registerSingleton('commandExecutor', () =>
    new CommandExecutor(
      container.get('validation'),
      container.get('config')
    )
  );

  container.registerSingleton('sshManager', () =>
    new SSHManager(container.get('config'))
  );

  return container;
}
```

---

## 5. Migration Strategy

### 5.1 Incremental Refactoring Approach

Given the current codebase is ~1500 lines in a single file, use an **incremental migration** strategy:

#### Phase 1: Foundation (Week 1)
1. Create folder structure
2. Implement DI container
3. Implement tool registry
4. Create bootstrap module
5. Add unit tests for core modules

#### Phase 2: Extract Domain Logic (Week 2)
1. Extract validation logic to `domain/services/ValidationService.ts`
2. Define interfaces in `domain/interfaces/`
3. Move domain models to `domain/models/`
4. Add tests for domain layer

#### Phase 3: Extract Infrastructure (Week 3)
1. Move SSH logic to `infrastructure/ssh/`
2. Move config logic to `infrastructure/config/`
3. Move command execution to `infrastructure/execution/`
4. Implement domain interfaces
5. Add tests for infrastructure layer

#### Phase 4: Create Tool Handlers (Week 4)
1. Convert each MCP tool to a tool handler in `tools/`
2. Register tools with registry
3. Update main server to use registry
4. Add integration tests

#### Phase 5: Cleanup (Week 5)
1. Remove old code from `src/index.ts`
2. Update documentation
3. Performance testing
4. Final integration testing

### 5.2 Strangler Fig Pattern

Use the **Strangler Fig Pattern** to gradually replace the old architecture:

```typescript
// src/index.ts - During migration

class CLIServer {
  private newToolRegistry?: ToolRegistry; // New system
  private legacyHandlers: Map<string, Function>; // Old system

  async handleCallTool(request: any) {
    const { name } = request.params;

    // Try new system first
    if (this.newToolRegistry?.has(name)) {
      return this.newToolRegistry.execute(name, request.params.arguments);
    }

    // Fallback to legacy
    const legacyHandler = this.legacyHandlers.get(name);
    if (legacyHandler) {
      return legacyHandler(request);
    }

    throw new Error(`Tool not found: ${name}`);
  }
}
```

### 5.3 Testing Strategy

```typescript
// __tests__/integration/migration.test.ts

describe('Migration compatibility', () => {
  it('should maintain backward compatibility with old tool handlers', async () => {
    const server = new CLIServer();
    await server.initialize();

    // Test that all existing tools still work
    const tools = ['execute_command', 'ssh_execute', 'validate_command'];

    for (const toolName of tools) {
      const result = await server.handleCallTool({
        params: { name: toolName, arguments: mockArgs },
      });

      expect(result).toBeDefined();
    }
  });
});
```

---

## 6. Code Examples

### 6.1 Complete Mini Example

Here's a minimal working example showing all patterns together:

```typescript
// src/core/Container.ts (simplified from section 1.2)
export class Container {
  private services = new Map<string, any>();

  register<T>(key: string, factory: () => T): this {
    this.services.set(key, factory);
    return this;
  }

  get<T>(key: string): T {
    const factory = this.services.get(key);
    if (!factory) throw new Error(`Service not found: ${key}`);
    return factory();
  }
}

// src/domain/interfaces/IValidator.ts
export interface IValidator {
  validate(cmd: string): Promise<boolean>;
}

// src/domain/services/SecurityService.ts
export class SecurityService {
  constructor(private validator: IValidator) {}

  async checkCommand(cmd: string): Promise<boolean> {
    return this.validator.validate(cmd);
  }
}

// src/infrastructure/CommandValidator.ts
import { IValidator } from '../domain/interfaces/IValidator.js';

export class CommandValidator implements IValidator {
  async validate(cmd: string): Promise<boolean> {
    // Implementation
    return !cmd.includes('rm -rf');
  }
}

// src/tools/check-command.tool.ts
import { z } from 'zod';

export const checkCommandTool = {
  name: 'check_command',
  inputSchema: z.object({ command: z.string() }),
  async handler(input: { command: string }) {
    const security = container.get<SecurityService>('security');
    return security.checkCommand(input.command);
  },
};

// src/bootstrap.ts
import { Container } from './core/Container.js';
import { SecurityService } from './domain/services/SecurityService.js';
import { CommandValidator } from './infrastructure/CommandValidator.js';

export function createContainer(): Container {
  const container = new Container();

  container.register('validator', () => new CommandValidator());
  container.register('security', () =>
    new SecurityService(container.get('validator'))
  );

  return container;
}

// src/index.ts
import { createContainer } from './bootstrap.js';

const container = createContainer();
const security = container.get<SecurityService>('security');

const isValid = await security.checkCommand('ls -la');
console.log('Command is valid:', isValid);
```

### 6.2 Testing Example

```typescript
// __tests__/domain/services/SecurityService.test.ts

import { SecurityService } from '../../../src/domain/services/SecurityService.js';
import { IValidator } from '../../../src/domain/interfaces/IValidator.js';

class MockValidator implements IValidator {
  async validate(cmd: string): Promise<boolean> {
    return cmd !== 'dangerous';
  }
}

describe('SecurityService', () => {
  let service: SecurityService;
  let validator: IValidator;

  beforeEach(() => {
    validator = new MockValidator();
    service = new SecurityService(validator);
  });

  it('should allow safe commands', async () => {
    const result = await service.checkCommand('ls -la');
    expect(result).toBe(true);
  });

  it('should block dangerous commands', async () => {
    const result = await service.checkCommand('dangerous');
    expect(result).toBe(false);
  });
});
```

---

## 7. Libraries and Resources

### 7.1 Recommended Libraries

#### DI Containers (if you want a library instead of custom)
- **[typed-inject](https://github.com/nicojs/typed-inject)** - Type-safe, no decorators, works with ES modules
- **[tsyringe](https://github.com/microsoft/tsyringe)** - Microsoft's lightweight DI container (requires decorators)
- **DIY approach** (recommended for this project) - Custom container as shown in section 1.2

#### Validation & Schemas
- **[zod](https://github.com/colinhacks/zod)** - Already in use, perfect for runtime validation
- Type-safe and composable

#### Testing
- **[jest](https://jestjs.io/)** - Already in use
- **[ts-jest](https://github.com/kulshekhar/ts-jest)** - TypeScript support for Jest (already configured)

### 7.2 Reference Articles

1. **Slash Engineering - Scaling 1M Lines of TypeScript: Registries**
   - URL: https://puzzles.slash.com/blog/scaling-1m-lines-of-typescript-registries
   - Key takeaway: Registry pattern for large codebases

2. **Khalil Stemmler - Clean Node.js Architecture**
   - URL: https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/
   - Key takeaway: Layered architecture, ports & adapters

3. **Building a Zero-Dependency DI Container in TypeScript**
   - URL: https://medium.com/@FAANG/building-a-zero-dependency-dependency-injection-container-in-typescript-12b51de66454
   - Key takeaway: Simple DI implementation

4. **Model Context Protocol - Official Documentation**
   - URL: https://modelcontextprotocol.io/docs/learn/architecture
   - Key takeaway: MCP server architecture patterns

5. **TypeScript Project Structure Best Practices**
   - URL: https://github.com/andredesousa/typescript-best-practices
   - Key takeaway: Folder organization for large projects

### 7.3 Example Repositories

1. **MCP TypeScript SDK**
   - URL: https://github.com/modelcontextprotocol/typescript-sdk
   - Official TypeScript SDK for MCP servers

2. **MCP Example Servers**
   - URL: https://github.com/modelcontextprotocol/servers
   - Collection of example MCP server implementations

3. **Clean Architecture Node.js**
   - URL: https://github.com/AzouKr/typescript-clean-architecture
   - Full example of clean architecture in TypeScript

---

## 8. Decision Matrix

### 8.1 DI Approach Comparison

| Approach | Pros | Cons | Recommended? |
|----------|------|------|--------------|
| **Manual Constructor Injection** | • Explicit<br>• No magic<br>• Works with ES modules<br>• Easy to debug | • More boilerplate<br>• Manual wiring | ✅ **YES** (for small services) |
| **Custom DI Container** | • Type-safe<br>• No external deps<br>• Full control<br>• ES module compatible | • Must maintain ourselves<br>• Less features | ✅ **YES** (recommended) |
| **tsyringe** | • Lightweight<br>• Microsoft-backed<br>• Well-documented | • Requires decorators<br>• Needs reflect-metadata<br>• Adds dependencies | ⚠️ Maybe (if decorators are acceptable) |
| **typed-inject** | • No decorators<br>• Type-safe<br>• Functional approach | • Learning curve<br>• Different paradigm | ⚠️ Maybe (if functional style preferred) |
| **InversifyJS** | • Feature-rich<br>• Mature | • Heavy framework<br>• Requires decorators<br>• Overkill for this project | ❌ NO |

### 8.2 Tool Registry Comparison

| Approach | Pros | Cons | Recommended? |
|----------|------|------|--------------|
| **Custom Registry Pattern** | • Simple<br>• Tailored to needs<br>• Type-safe<br>• Proven at scale | • Must implement ourselves | ✅ **YES** |
| **Switch Statement** (current) | • Simple<br>• Explicit | • Hard to extend<br>• Poor separation of concerns<br>• Not scalable | ❌ NO |
| **Plugin System** | • Very flexible<br>• Runtime loading | • Complex<br>• Overkill | ❌ NO |

### 8.3 Project Structure Comparison

| Approach | Pros | Cons | Recommended? |
|----------|------|------|--------------|
| **Layered Architecture** | • Clear separation<br>• Testable<br>• Scalable<br>• Industry standard | • More folders<br>• Initial learning curve | ✅ **YES** |
| **Feature-Based** | • Cohesive features<br>• Easy to find code | • Cross-cutting concerns harder<br>• Can lead to duplication | ⚠️ Maybe (for smaller projects) |
| **Flat Structure** (current) | • Simple to start | • Doesn't scale<br>• Hard to navigate<br>• Poor organization | ❌ NO |

---

## 9. Implementation Checklist

### Phase 1: Foundation
- [ ] Create new folder structure (`core/`, `domain/`, `infrastructure/`, `tools/`)
- [ ] Implement `Container.ts` (DI container)
- [ ] Implement `ToolRegistry.ts`
- [ ] Create `bootstrap.ts` for container setup
- [ ] Add unit tests for container and registry

### Phase 2: Domain Layer
- [ ] Create `domain/interfaces/` with all interface definitions
- [ ] Extract validation logic to `domain/services/ValidationService.ts`
- [ ] Create domain models in `domain/models/`
- [ ] Add tests for all domain services

### Phase 3: Infrastructure Layer
- [ ] Move SSH code to `infrastructure/ssh/`
- [ ] Move config code to `infrastructure/config/`
- [ ] Move execution code to `infrastructure/execution/`
- [ ] Ensure all infrastructure implements domain interfaces
- [ ] Add tests for all infrastructure services

### Phase 4: Tools & Resources
- [ ] Create tool handlers in `tools/` directory
- [ ] Implement auto-loading with `ToolLoader.ts`
- [ ] Convert all existing MCP tools to handler pattern
- [ ] Update resource providers
- [ ] Add integration tests

### Phase 5: Integration
- [ ] Update `src/index.ts` to use new architecture
- [ ] Ensure backward compatibility
- [ ] Remove old code after migration complete
- [ ] Update documentation
- [ ] Performance testing

### Phase 6: Polish
- [ ] Add JSDoc comments to all public APIs
- [ ] Update README.md
- [ ] Update CLAUDE.md
- [ ] Create migration guide
- [ ] Final code review

---

## 10. Conclusion

### Summary of Recommendations

1. **DI Approach**: Use a custom, lightweight DI container with manual constructor injection
   - No decorators, no heavy dependencies
   - Type-safe with TypeScript symbols
   - Works seamlessly with ES modules

2. **Tool Registry**: Implement a registry pattern for tool handlers
   - Inspired by Slash Engineering's approach for scaling large codebases
   - Auto-discovery using file naming conventions
   - Type-safe and extensible

3. **Project Structure**: Adopt layered architecture
   - Domain layer: business logic, zero external dependencies
   - Infrastructure layer: concrete implementations
   - Application layer: MCP tools and resources
   - Core layer: framework abstractions

4. **Migration Strategy**: Incremental refactoring using Strangler Fig pattern
   - 5-week phased approach
   - Maintain backward compatibility
   - Test at each step

### Next Steps

1. Review this document with the team
2. Decide on migration timeline
3. Start with Phase 1 (Foundation)
4. Iterate based on feedback

### Questions to Consider

- Do we want auto-loading of tools or explicit registration?
- Should we use TypeScript symbols or strings for service keys?
- What's the acceptable timeline for migration?
- Should we migrate everything or just new code?

---

**Document Version**: 1.0
**Last Updated**: 2025-10-08
**Author**: Claude Code Research Agent
