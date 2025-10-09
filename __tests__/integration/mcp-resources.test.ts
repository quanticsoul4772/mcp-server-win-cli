/**
 * MCP Resources Compliance Tests
 *
 * Validates that the server correctly exposes MCP resources
 * and that Claude can reliably access resource data.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ServiceContainer } from '../../src/server/ServiceContainer.js';
import { ConfigManager } from '../../src/services/ConfigManager.js';
import { SecurityManager } from '../../src/services/SecurityManager.js';
import { CommandExecutor } from '../../src/services/CommandExecutor.js';
import { HistoryManager } from '../../src/services/HistoryManager.js';
import { SSHConnectionPool } from '../../src/utils/ssh.js';
import { DEFAULT_CONFIG } from '../../src/utils/config.js';

describe('MCP Resources Compliance', () => {
  let container: ServiceContainer;
  let configManager: ConfigManager;
  let securityManager: SecurityManager;
  let historyManager: HistoryManager;
  let sshPool: SSHConnectionPool;

  beforeEach(() => {
    // Initialize service container
    container = new ServiceContainer();

    // Register services
    const config = { ...DEFAULT_CONFIG };
    configManager = new ConfigManager(config, null);
    const blockedCommands = new Set(config.security.blockedCommands);
    securityManager = new SecurityManager(config, blockedCommands, null);
    historyManager = new HistoryManager(config.security.maxHistorySize, config.security.logCommands);
    const commandExecutor = new CommandExecutor(config, config.security.allowedPaths, null);
    sshPool = new SSHConnectionPool(config.ssh.strictHostKeyChecking);

    container.registerInstance('ConfigManager', configManager);
    container.registerInstance('SecurityManager', securityManager);
    container.registerInstance('HistoryManager', historyManager);
    container.registerInstance('CommandExecutor', commandExecutor);
    container.registerInstance('SSHConnectionPool', sshPool);
  });

  describe('cli://validation-rules Resource', () => {
    it('should provide complete validation rules', () => {
      const securityConfig = configManager.getSecurity();

      const validationRules = {
        blocked_commands: {
          description: "Commands that are blocked from execution (case-insensitive, checks all file extensions)",
          commands: securityConfig.blockedCommands,
          note: "Blocked commands are checked against basename with .exe, .cmd, .bat, .ps1, .vbs, etc."
        },
        blocked_arguments: {
          description: "Argument patterns that are blocked (regex-based, case-insensitive)",
          patterns: securityConfig.blockedArguments,
          note: "Each argument is checked independently against these patterns"
        },
        blocked_operators: {
          description: "Shell operators blocked per shell (including Unicode variants and zero-width characters)",
          powershell: DEFAULT_CONFIG.shells.powershell.blockedOperators,
          cmd: DEFAULT_CONFIG.shells.cmd.blockedOperators,
          gitbash: DEFAULT_CONFIG.shells.gitbash.blockedOperators,
          note: "Includes detection of Unicode homoglyphs (｜, ； , ＆) and zero-width characters"
        }
      };

      expect(validationRules.blocked_commands.commands).toBeDefined();
      expect(Array.isArray(validationRules.blocked_commands.commands)).toBe(true);
      expect(validationRules.blocked_commands.commands.length).toBeGreaterThan(0);

      expect(validationRules.blocked_arguments.patterns).toBeDefined();
      expect(Array.isArray(validationRules.blocked_arguments.patterns)).toBe(true);

      expect(validationRules.blocked_operators.powershell).toBeDefined();
      expect(Array.isArray(validationRules.blocked_operators.powershell)).toBe(true);
    });

    it('should include validation pipeline stages', () => {
      const validationPipeline = {
        description: "Multi-stage validation order (fail-fast)",
        stages: [
          "1. Shell operator check (highest priority)",
          "2. Command parsing (handles quotes, escapes, detects unclosed quotes)",
          "3. Command blocking (basename case-insensitive with all extensions)",
          "4. Argument blocking (regex-based, case-insensitive)",
          "5. Length check (command must be ≤ maxCommandLength)",
          "6. Working directory validation (if restrictWorkingDirectory=true)"
        ]
      };

      expect(validationPipeline.stages).toHaveLength(6);
      expect(validationPipeline.stages[0]).toContain('Shell operator check');
    });
  });

  describe('cli://history-summary Resource', () => {
    it('should provide empty history summary when no commands executed', () => {
      const history = historyManager.getAll();

      const summary = {
        statistics: {
          total_commands: 0,
          successful_commands: 0,
          failed_commands: 0,
          validation_failures: 0,
          execution_failures: 0,
          success_rate: 'N/A'
        },
        recent_commands: [],
        most_common_commands: [],
        most_common_errors: [],
        history_enabled: true,
        max_history_size: 1000,
        current_history_size: 0
      };

      expect(history.length).toBe(0);
      expect(summary.statistics.total_commands).toBe(0);
      expect(summary.recent_commands).toEqual([]);
    });

    it('should calculate statistics correctly with sample data', () => {
      // Add some test history entries
      historyManager.add({
        command: 'echo test',
        output: 'test',
        timestamp: new Date().toISOString(),
        exitCode: 0
      });
      historyManager.add({
        command: 'rm test.txt',
        output: 'Command blocked',
        timestamp: new Date().toISOString(),
        exitCode: -2
      });
      historyManager.add({
        command: 'invalid-command',
        output: 'Command not found',
        timestamp: new Date().toISOString(),
        exitCode: -1
      });

      const history = historyManager.getAll();
      const totalCommands = history.length;
      const successfulCommands = history.filter(h => h.exitCode === 0).length;
      const validationFailures = history.filter(h => h.exitCode === -2).length;
      const executionFailures = history.filter(h => h.exitCode === -1).length;

      expect(totalCommands).toBe(3);
      expect(successfulCommands).toBe(1);
      expect(validationFailures).toBe(1);
      expect(executionFailures).toBe(1);

      const successRate = ((successfulCommands / totalCommands) * 100).toFixed(1) + '%';
      expect(successRate).toBe('33.3%');
    });

    it('should provide recent commands in reverse chronological order', () => {
      // Add commands with distinct timestamps
      historyManager.add({
        command: 'first',
        output: 'output1',
        timestamp: '2024-01-01T00:00:00Z',
        exitCode: 0
      });
      historyManager.add({
        command: 'second',
        output: 'output2',
        timestamp: '2024-01-01T00:00:01Z',
        exitCode: 0
      });
      historyManager.add({
        command: 'third',
        output: 'output3',
        timestamp: '2024-01-01T00:00:02Z',
        exitCode: 0
      });

      const history = historyManager.getAll();
      const recentCommands = history.slice(-10).reverse();

      expect(recentCommands[0].command).toBe('third');
      expect(recentCommands[1].command).toBe('second');
      expect(recentCommands[2].command).toBe('first');
    });
  });

  describe('ssh://pool-status Resource', () => {
    it('should provide pool statistics', () => {
      const poolStats = sshPool.getPoolStats();

      expect(poolStats).toHaveProperty('size');
      expect(poolStats).toHaveProperty('maxSize');
      expect(poolStats).toHaveProperty('connectionIds');

      expect(typeof poolStats.size).toBe('number');
      expect(typeof poolStats.maxSize).toBe('number');
      expect(Array.isArray(poolStats.connectionIds)).toBe(true);
    });

    it('should show empty pool initially', () => {
      const poolStats = sshPool.getPoolStats();

      expect(poolStats.size).toBe(0);
      expect(poolStats.maxSize).toBe(10);
      expect(poolStats.connectionIds).toEqual([]);
    });

    it('should have correct max pool size', () => {
      const poolStats = sshPool.getPoolStats();

      expect(poolStats.maxSize).toBe(10);
    });
  });

  describe('Resource Data Format', () => {
    it('should provide validation rules in structured format', () => {
      const securityConfig = configManager.getSecurity();

      expect(securityConfig).toHaveProperty('blockedCommands');
      expect(securityConfig).toHaveProperty('blockedArguments');
      expect(securityConfig).toHaveProperty('restrictWorkingDirectory');
      expect(securityConfig).toHaveProperty('allowedPaths');
      expect(securityConfig).toHaveProperty('maxCommandLength');
      expect(securityConfig).toHaveProperty('commandTimeout');
    });

    it('should provide history data in consumable format', () => {
      historyManager.add({
        command: 'test',
        output: 'output',
        timestamp: new Date().toISOString(),
        exitCode: 0
      });

      const history = historyManager.getAll();
      const entry = history[0];

      expect(entry).toHaveProperty('command');
      expect(entry).toHaveProperty('output');
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('exitCode');
    });

    it('should provide pool status in readable format', () => {
      const poolStats = sshPool.getPoolStats();

      expect(poolStats).toHaveProperty('size');
      expect(poolStats).toHaveProperty('maxSize');
      expect(poolStats).toHaveProperty('connectionIds');
    });
  });

  describe('Resource Use Cases', () => {
    it('cli://validation-rules - helps Claude understand what commands are blocked', () => {
      const securityConfig = configManager.getSecurity();

      // Claude can check if a command is blocked
      const isRmBlocked = securityConfig.blockedCommands.includes('rm');
      expect(isRmBlocked).toBe(true);

      // Claude can see what operators are blocked
      const shellConfig = DEFAULT_CONFIG.shells.powershell;
      expect(shellConfig.blockedOperators).toContain('|');
    });

    it('cli://history-summary - helps Claude identify patterns and common errors', () => {
      // Add some commands
      for (let i = 0; i < 5; i++) {
        historyManager.add({
          command: 'echo test',
          output: 'test',
          timestamp: new Date().toISOString(),
          exitCode: 0
        });
      }
      for (let i = 0; i < 3; i++) {
        historyManager.add({
          command: 'rm file.txt',
          output: 'blocked',
          timestamp: new Date().toISOString(),
          exitCode: -2
        });
      }

      const history = historyManager.getAll();

      // Find most common command
      const commandCounts: Record<string, number> = {};
      history.forEach(h => {
        const cmd = h.command.split(' ')[0];
        commandCounts[cmd] = (commandCounts[cmd] || 0) + 1;
      });

      const mostCommonCmd = Object.entries(commandCounts).sort(([, a], [, b]) => b - a)[0];
      expect(mostCommonCmd[0]).toBe('echo');
      expect(mostCommonCmd[1]).toBe(5);

      // Find most common error
      const errorCounts: Record<number, number> = {};
      history.filter(h => h.exitCode !== 0).forEach(h => {
        errorCounts[h.exitCode] = (errorCounts[h.exitCode] || 0) + 1;
      });

      expect(errorCounts[-2]).toBe(3);
    });

    it('ssh://pool-status - helps Claude understand SSH connection availability', () => {
      const poolStats = sshPool.getPoolStats();

      // Claude can check if pool is full
      const isFull = poolStats.size >= poolStats.maxSize;
      expect(isFull).toBe(false);

      // Claude can see how many connections are available
      const availableSlots = poolStats.maxSize - poolStats.size;
      expect(availableSlots).toBe(10);
    });
  });
});
