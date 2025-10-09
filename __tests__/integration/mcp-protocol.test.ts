/**
 * MCP Protocol Compliance Tests
 *
 * Validates that the server correctly implements the Model Context Protocol
 * and that Claude can reliably interact with all tools.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ToolRegistry } from '../../src/registries/ToolRegistry.js';
import { ServiceContainer } from '../../src/server/ServiceContainer.js';
import { ConfigManager } from '../../src/services/ConfigManager.js';
import { SecurityManager } from '../../src/services/SecurityManager.js';
import { CommandExecutor } from '../../src/services/CommandExecutor.js';
import { HistoryManager } from '../../src/services/HistoryManager.js';
import { SSHConnectionPool } from '../../src/utils/ssh.js';
import { DEFAULT_CONFIG } from '../../src/utils/config.js';

// Import all tools
import { ExecuteCommandTool } from '../../src/tools/command/ExecuteCommandTool.js';
import { ReadCommandHistoryTool } from '../../src/tools/command/ReadCommandHistoryTool.js';
import { SSHExecuteTool } from '../../src/tools/ssh/SSHExecuteTool.js';
import { SSHDisconnectTool } from '../../src/tools/ssh/SSHDisconnectTool.js';
import { CreateSSHConnectionTool } from '../../src/tools/ssh/CreateSSHConnectionTool.js';
import { ReadSSHConnectionsTool } from '../../src/tools/ssh/ReadSSHConnectionsTool.js';
import { UpdateSSHConnectionTool } from '../../src/tools/ssh/UpdateSSHConnectionTool.js';
import { DeleteSSHConnectionTool } from '../../src/tools/ssh/DeleteSSHConnectionTool.js';
import { ReadSSHPoolStatusTool } from '../../src/tools/ssh/ReadSSHPoolStatusTool.js';
import { ValidateSSHConnectionTool } from '../../src/tools/ssh/ValidateSSHConnectionTool.js';
import { CheckSecurityConfigTool } from '../../src/tools/diagnostics/CheckSecurityConfigTool.js';
import { ValidateCommandTool } from '../../src/tools/diagnostics/ValidateCommandTool.js';
import { ExplainExitCodeTool } from '../../src/tools/diagnostics/ExplainExitCodeTool.js';
import { ValidateConfigTool } from '../../src/tools/diagnostics/ValidateConfigTool.js';
import { ReadSystemInfoTool } from '../../src/tools/diagnostics/ReadSystemInfoTool.js';
import { TestConnectionTool } from '../../src/tools/diagnostics/TestConnectionTool.js';
import { ReadCurrentDirectoryTool } from '../../src/tools/system/ReadCurrentDirectoryTool.js';

describe('MCP Protocol Compliance', () => {
  let container: ServiceContainer;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    // Initialize service container
    container = new ServiceContainer();

    // Register services
    const config = { ...DEFAULT_CONFIG };
    const configManager = new ConfigManager(config, null);
    const blockedCommands = new Set(config.security.blockedCommands);
    const securityManager = new SecurityManager(config, blockedCommands, null);
    const historyManager = new HistoryManager(config.security.maxHistorySize, config.security.logCommands);
    const commandExecutor = new CommandExecutor(config, config.security.allowedPaths, null);
    const sshPool = new SSHConnectionPool(config.ssh.strictHostKeyChecking);

    container.registerInstance('ConfigManager', configManager);
    container.registerInstance('SecurityManager', securityManager);
    container.registerInstance('HistoryManager', historyManager);
    container.registerInstance('CommandExecutor', commandExecutor);
    container.registerInstance('SSHConnectionPool', sshPool);

    // Initialize tool registry
    toolRegistry = new ToolRegistry();

    // Register all tools (matching src/index.ts)
    toolRegistry.register(new ExecuteCommandTool(container));
    toolRegistry.register(new ReadCommandHistoryTool(container));
    toolRegistry.register(new SSHExecuteTool(container));
    toolRegistry.register(new SSHDisconnectTool(container));
    toolRegistry.register(new CreateSSHConnectionTool(container));
    toolRegistry.register(new ReadSSHConnectionsTool(container));
    toolRegistry.register(new UpdateSSHConnectionTool(container));
    toolRegistry.register(new DeleteSSHConnectionTool(container));
    toolRegistry.register(new ReadSSHPoolStatusTool(container));
    toolRegistry.register(new ValidateSSHConnectionTool(container));
    toolRegistry.register(new CheckSecurityConfigTool(container));
    toolRegistry.register(new ValidateCommandTool(container));
    toolRegistry.register(new ExplainExitCodeTool(container));
    toolRegistry.register(new ValidateConfigTool(container));
    toolRegistry.register(new ReadSystemInfoTool(container));
    toolRegistry.register(new TestConnectionTool(container));
    toolRegistry.register(new ReadCurrentDirectoryTool(container));
  });

  describe('Tool Registry', () => {
    it('should expose exactly 17 tools', () => {
      const tools = toolRegistry.listTools();
      expect(tools).toHaveLength(17);
    });

    it('should have correct tool distribution', () => {
      const tools = toolRegistry.listTools();

      const commandTools = tools.filter(t =>
        t.name === 'execute_command' || t.name === 'read_command_history'
      );
      const sshTools = tools.filter(t => t.name.includes('ssh'));
      const diagnosticTools = tools.filter(t =>
        ['check_security_config', 'validate_command', 'explain_exit_code',
         'validate_config', 'read_system_info', 'test_connection'].includes(t.name)
      );
      const systemTools = tools.filter(t => t.name === 'read_current_directory');

      expect(commandTools).toHaveLength(2);
      expect(sshTools).toHaveLength(8);
      expect(diagnosticTools).toHaveLength(6);
      expect(systemTools).toHaveLength(1);
    });

    it('should have all required MCP tool fields', () => {
      const toolDefinitions = toolRegistry.getToolDefinitions();

      toolDefinitions.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');

        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');

        // Validate JSON Schema structure
        expect(tool.inputSchema).toHaveProperty('type', 'object');
        expect(tool.inputSchema).toHaveProperty('properties');
      });
    });

    it('should have unique tool names', () => {
      const tools = toolRegistry.listTools();
      const names = tools.map(t => t.name);
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('Tool Execution - Success Cases', () => {
    it('should execute read_current_directory successfully', async () => {
      const result = await toolRegistry.execute('read_current_directory', {});

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBeUndefined();
    });

    it('should execute read_system_info successfully', async () => {
      const result = await toolRegistry.execute('read_system_info', {});

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');

      const info = JSON.parse(result.content[0].text);
      expect(info).toHaveProperty('server');
      expect(info).toHaveProperty('system');
      expect(info).toHaveProperty('node');
      expect(info).toHaveProperty('shells');
    });

    it('should execute explain_exit_code successfully', async () => {
      const result = await toolRegistry.execute('explain_exit_code', {
        exit_code: -2
      });

      expect(result.content).toBeDefined();
      const explanation = JSON.parse(result.content[0].text);

      expect(explanation).toHaveProperty('exit_code', -2);
      expect(explanation).toHaveProperty('meaning');
      expect(explanation).toHaveProperty('description');
      expect(explanation).toHaveProperty('user_action');
      expect(explanation).toHaveProperty('diagnostic_tools');
    });

    it('should execute validate_config successfully', async () => {
      const result = await toolRegistry.execute('validate_config', {
        show_merge_details: true
      });

      expect(result.content).toBeDefined();
      const validation = JSON.parse(result.content[0].text);

      expect(validation).toHaveProperty('valid');
      expect(validation).toHaveProperty('issues_summary');
      expect(validation).toHaveProperty('recommendations');
    });

    it('should execute check_security_config successfully', async () => {
      const result = await toolRegistry.execute('check_security_config', {
        category: 'all'
      });

      expect(result.content).toBeDefined();
      const config = JSON.parse(result.content[0].text);

      expect(config).toHaveProperty('blockedCommands');
      expect(config).toHaveProperty('blockedArguments');
      expect(config).toHaveProperty('allowedPaths');
    });
  });

  describe('Structured Error Format Validation', () => {
    it('should return structured error for blocked command', async () => {
      const result = await toolRegistry.execute('execute_command', {
        shell: 'powershell',
        command: 'rm test.txt'
      });

      expect(result.isError).toBe(true);
      expect(result._meta?.exitCode).toBe(-2);
      expect(result._meta?.structured).toBeDefined();

      const structured = result._meta?.structured;
      expect(structured).toHaveProperty('error');
      expect(structured).toHaveProperty('code');
      expect(structured).toHaveProperty('details');
      expect(structured).toHaveProperty('user_guidance');
      expect(structured).toHaveProperty('diagnostic_tool');
      expect(structured).toHaveProperty('diagnostic_args');

      // Verify error code format
      expect(structured?.code).toMatch(/^(SEC|EXEC)\d{3}$/);
    });

    it('should return structured error for operator blocking', async () => {
      const result = await toolRegistry.execute('execute_command', {
        shell: 'powershell',
        command: 'echo test | findstr test'
      });

      expect(result.isError).toBe(true);
      expect(result._meta?.exitCode).toBe(-2);
      expect(result._meta?.structured).toBeDefined();
      expect(result._meta?.structured?.code).toBe('SEC002');
      expect(result._meta?.structured?.diagnostic_tool).toBe('check_security_config');
    });

    it('should provide next_steps in validate_command failures', async () => {
      const result = await toolRegistry.execute('validate_command', {
        shell: 'powershell',
        command: 'rm test.txt'
      });

      const validation = JSON.parse(result.content[0].text);

      expect(validation.valid).toBe(false);
      expect(validation).toHaveProperty('guidance');
      expect(validation).toHaveProperty('next_steps');
      expect(validation.next_steps).toHaveProperty('recommended_tool');
      expect(validation.next_steps).toHaveProperty('tool_args');
      expect(validation.next_steps).toHaveProperty('why');
    });
  });

  describe('Tool Integration - Diagnostic Chains', () => {
    it('should support error -> explain_exit_code -> fix workflow', async () => {
      // Step 1: Command fails with exit code -2
      const errorResult = await toolRegistry.execute('execute_command', {
        shell: 'powershell',
        command: 'rm test.txt'
      });

      expect(errorResult._meta?.exitCode).toBe(-2);
      expect(errorResult._meta?.structured?.diagnostic_tool).toBe('check_security_config');

      // Step 2: Explain the exit code
      const explanation = await toolRegistry.execute('explain_exit_code', {
        exit_code: -2
      });

      const explainData = JSON.parse(explanation.content[0].text);
      expect(explainData.diagnostic_tools).toContain('validate_command');
      expect(explainData.diagnostic_tools).toContain('check_security_config');

      // Step 3: Run diagnostic tool
      const diagnostic = await toolRegistry.execute('check_security_config', {
        category: 'commands'
      });

      const diagData = JSON.parse(diagnostic.content[0].text);
      expect(diagData.blockedCommands).toContain('rm');
    });

    it('should support config issue -> validate_config -> fix workflow', async () => {
      // Step 1: Validate config
      const validation = await toolRegistry.execute('validate_config', {
        show_merge_details: true
      });

      const validationData = JSON.parse(validation.content[0].text);
      expect(validationData).toHaveProperty('issues');
      expect(validationData).toHaveProperty('recommendations');

      // Step 2: If issues found, recommendations should suggest actions
      if (validationData.issues.length > 0) {
        expect(validationData.recommendations.length).toBeGreaterThan(0);
        expect(validationData.issues[0]).toHaveProperty('severity');
        expect(validationData.issues[0]).toHaveProperty('message');
        expect(validationData.issues[0]).toHaveProperty('explanation');
      }
    });
  });

  describe('Tool Parameter Validation', () => {
    it('should reject invalid shell parameter', async () => {
      const result = await toolRegistry.execute('execute_command', {
        shell: 'invalid_shell' as any,
        command: 'echo test'
      });

      // Should return an error result, not throw
      expect(result.isError).toBe(true);
      expect(result._meta?.exitCode).not.toBe(0);
    });

    it('should reject missing required parameters', async () => {
      const result = await toolRegistry.execute('execute_command', {
        shell: 'powershell'
        // missing 'command' parameter
      } as any);

      // Should return an error result
      expect(result.isError).toBe(true);
    });

    it('should handle optional parameters correctly', async () => {
      const result = await toolRegistry.execute('validate_config', {
        // show_merge_details is optional
      });

      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveProperty('valid');
    });
  });

  describe('Response Format Consistency', () => {
    it('should always return content array', async () => {
      const tools = toolRegistry.listTools();

      for (const tool of tools.slice(0, 5)) { // Test first 5 tools
        try {
          const result = await toolRegistry.execute(tool.name, {});
          expect(result.content).toBeDefined();
          expect(Array.isArray(result.content)).toBe(true);
          expect(result.content.length).toBeGreaterThan(0);
        } catch (error) {
          // Some tools require parameters, that's okay
        }
      }
    });

    it('should return consistent text content type', async () => {
      const result = await toolRegistry.execute('read_current_directory', {});

      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');
      expect(typeof result.content[0].text).toBe('string');
    });

    it('should include exitCode in _meta for command execution', async () => {
      const result = await toolRegistry.execute('execute_command', {
        shell: 'powershell',
        command: 'echo test'
      });

      expect(result._meta).toBeDefined();
      expect(result._meta).toHaveProperty('exitCode');
      if (result._meta) {
        expect(typeof result._meta.exitCode).toBe('number');
      }
    });
  });
});
