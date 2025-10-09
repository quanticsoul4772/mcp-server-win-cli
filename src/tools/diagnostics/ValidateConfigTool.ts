import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { ConfigManager } from '../../services/ConfigManager.js';
import { DEFAULT_CONFIG } from '../../utils/config.js';

interface ValidateConfigArgs {
  show_merge_details?: boolean;
}

interface ConfigIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  explanation: string;
  fix?: string;
  details?: Record<string, any>;
}

/**
 * Tool to validate configuration and explain merge behavior
 *
 * Critical tool for helping Claude understand and troubleshoot config issues.
 * Explains the security-first merge strategy:
 * - allowedPaths: INTERSECTION (only paths in BOTH default AND user config)
 * - blockedCommands/blockedArguments: UNION (all blocks from both configs)
 * - Security limits: Most restrictive value wins
 */
export class ValidateConfigTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'validate_config',
      '[Diagnostics] Validate configuration file and show how it merges with defaults',
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        show_merge_details: {
          type: 'boolean',
          description: 'Show detailed merge process (intersection for paths, union for blocks)',
          default: true
        }
      }
    };
  }

  async execute(args: ValidateConfigArgs): Promise<ToolResult> {
    const configManager = this.getService<ConfigManager>('ConfigManager');
    const mergedConfig = configManager.getConfig();
    const configPath = configManager.getConfigPath();

    const issues: ConfigIssue[] = [];
    const showDetails = args.show_merge_details !== false;

    // Check for empty allowedPaths (critical issue)
    if (mergedConfig.security.allowedPaths.length === 0) {
      issues.push({
        severity: 'error',
        category: 'allowedPaths',
        message: 'allowedPaths is EMPTY after merge! No commands can execute.',
        explanation: 'allowedPaths uses INTERSECTION (not union). Only paths present in BOTH default config AND your custom config are allowed. Since there is no overlap, the result is empty.',
        fix: `Add these default paths to your config.json:\n${JSON.stringify(DEFAULT_CONFIG.security.allowedPaths, null, 2)}\n\nOr add paths that overlap with defaults.`,
        details: {
          default_paths: DEFAULT_CONFIG.security.allowedPaths,
          merged_paths: mergedConfig.security.allowedPaths,
          strategy: 'INTERSECTION'
        }
      });
    }

    // Check if allowedPaths is significantly reduced
    if (mergedConfig.security.allowedPaths.length > 0 &&
        mergedConfig.security.allowedPaths.length < DEFAULT_CONFIG.security.allowedPaths.length) {
      issues.push({
        severity: 'warning',
        category: 'allowedPaths',
        message: `Only ${mergedConfig.security.allowedPaths.length} of ${DEFAULT_CONFIG.security.allowedPaths.length} default paths are allowed.`,
        explanation: 'allowedPaths uses INTERSECTION. Your custom config has reduced the allowed paths. This may be intentional for security, but verify it includes all paths you need.',
        details: {
          default_paths: DEFAULT_CONFIG.security.allowedPaths,
          merged_paths: mergedConfig.security.allowedPaths,
          removed_paths: DEFAULT_CONFIG.security.allowedPaths.filter(
            p => !mergedConfig.security.allowedPaths.includes(p)
          )
        }
      });
    }

    // Check if restrictWorkingDirectory is disabled
    if (!mergedConfig.security.restrictWorkingDirectory) {
      issues.push({
        severity: 'warning',
        category: 'restrictWorkingDirectory',
        message: 'Working directory restrictions are DISABLED.',
        explanation: 'With restrictWorkingDirectory set to false, commands can execute in ANY directory on the system. This significantly reduces security.',
        fix: 'Consider enabling restrictWorkingDirectory and properly configuring allowedPaths instead.',
        details: {
          current_value: false,
          security_risk: 'high'
        }
      });
    }

    // Check command timeout
    if (mergedConfig.security.commandTimeout > 120) {
      issues.push({
        severity: 'info',
        category: 'commandTimeout',
        message: `Command timeout is set to ${mergedConfig.security.commandTimeout} seconds (over 2 minutes).`,
        explanation: 'Long timeouts can cause Claude to wait a long time for stuck commands. Consider if this is necessary.',
        details: {
          current_value: mergedConfig.security.commandTimeout,
          default_value: DEFAULT_CONFIG.security.commandTimeout
        }
      });
    }

    // Check if critical commands are unblocked
    const criticalCommands = ['rm', 'del', 'format', 'shutdown', 'reg', 'regedit'];
    const unblockedCritical = criticalCommands.filter(
      cmd => !mergedConfig.security.blockedCommands.includes(cmd)
    );

    if (unblockedCritical.length > 0) {
      issues.push({
        severity: 'warning',
        category: 'blockedCommands',
        message: `Critical commands are not blocked: ${unblockedCritical.join(', ')}`,
        explanation: 'These commands can cause data loss or system changes. blockedCommands uses UNION strategy, so blocks from defaults should be included unless explicitly overridden.',
        fix: `Add these to blockedCommands in your config:\n${JSON.stringify(unblockedCritical, null, 2)}`,
        details: {
          unblocked_commands: unblockedCritical,
          all_blocked: mergedConfig.security.blockedCommands
        }
      });
    }

    // Check for empty blockedOperators (potential security issue)
    const shellsWithoutBlocks = Object.entries(mergedConfig.shells)
      .filter(([_, shellConfig]) =>
        shellConfig.enabled &&
        (!shellConfig.blockedOperators || shellConfig.blockedOperators.length === 0)
      )
      .map(([name, _]) => name);

    if (shellsWithoutBlocks.length > 0) {
      issues.push({
        severity: 'warning',
        category: 'blockedOperators',
        message: `Shells without blocked operators: ${shellsWithoutBlocks.join(', ')}`,
        explanation: 'These shells allow command chaining, pipes, and redirects. This increases command injection risk.',
        fix: 'Add blockedOperators: ["&", "|", ";", "`"] to each shell configuration.',
        details: {
          shells_at_risk: shellsWithoutBlocks
        }
      });
    }

    // Check if SSH is enabled without strictHostKeyChecking
    if (mergedConfig.ssh.enabled && !mergedConfig.ssh.strictHostKeyChecking) {
      issues.push({
        severity: 'warning',
        category: 'ssh',
        message: 'SSH host key checking is disabled (TOFU mode).',
        explanation: 'With strictHostKeyChecking disabled, the server will accept unknown host keys (Trust On First Use). This is vulnerable to MITM attacks on first connection.',
        fix: 'Consider enabling strictHostKeyChecking after establishing trusted connections.',
        details: {
          current_value: false,
          security_risk: 'medium',
          mitigation: 'TOFU (Trust On First Use) provides some protection after first connection'
        }
      });
    }

    // Build merge summary
    const mergeSummary = showDetails ? {
      allowedPaths: {
        strategy: 'INTERSECTION',
        explanation: 'Only paths in BOTH default AND custom config are allowed',
        default: DEFAULT_CONFIG.security.allowedPaths,
        merged: mergedConfig.security.allowedPaths,
        note: 'If empty, add default paths to your config or disable restrictWorkingDirectory'
      },
      blockedCommands: {
        strategy: 'UNION',
        explanation: 'All blocks from default AND custom config are combined',
        default: DEFAULT_CONFIG.security.blockedCommands,
        merged: mergedConfig.security.blockedCommands,
        note: 'Your blocks are ADDED to defaults, not replaced'
      },
      blockedArguments: {
        strategy: 'UNION',
        explanation: 'All argument blocks from default AND custom config are combined',
        default: DEFAULT_CONFIG.security.blockedArguments,
        merged: mergedConfig.security.blockedArguments
      },
      securityLimits: {
        strategy: 'MOST RESTRICTIVE',
        explanation: 'For numeric limits, the more restrictive value is used',
        maxCommandLength: {
          default: DEFAULT_CONFIG.security.maxCommandLength,
          merged: mergedConfig.security.maxCommandLength,
          note: 'Uses Math.min(default, custom)'
        },
        commandTimeout: {
          default: DEFAULT_CONFIG.security.commandTimeout,
          merged: mergedConfig.security.commandTimeout,
          note: 'Uses Math.min(default, custom)'
        }
      }
    } : undefined;

    // Determine overall validity
    const hasErrors = issues.some(i => i.severity === 'error');
    const hasWarnings = issues.some(i => i.severity === 'warning');

    const result = {
      valid: !hasErrors,
      config_path: configPath || '(using defaults)',
      issues_summary: {
        errors: issues.filter(i => i.severity === 'error').length,
        warnings: issues.filter(i => i.severity === 'warning').length,
        info: issues.filter(i => i.severity === 'info').length
      },
      issues,
      ...(mergeSummary && { merge_details: mergeSummary }),
      recommendations: this.getRecommendations(issues, hasErrors, hasWarnings)
    };

    return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
  }

  private getRecommendations(issues: ConfigIssue[], hasErrors: boolean, hasWarnings: boolean): string[] {
    const recommendations: string[] = [];

    if (hasErrors) {
      recommendations.push('⚠️ CRITICAL: Fix errors immediately. The server may not function correctly.');
    }

    if (issues.some(i => i.category === 'allowedPaths' && i.severity === 'error')) {
      recommendations.push('Add default paths to your allowedPaths, or disable restrictWorkingDirectory temporarily.');
    }

    if (issues.some(i => i.category === 'blockedCommands' && i.severity === 'warning')) {
      recommendations.push('Review and block critical commands to prevent accidental data loss.');
    }

    if (hasWarnings) {
      recommendations.push('Review warnings and adjust config for better security and functionality.');
    }

    if (!hasErrors && !hasWarnings) {
      recommendations.push('✅ Configuration looks good! No issues detected.');
    }

    recommendations.push('Use check_security_config tool to view specific security settings.');
    recommendations.push('Use validate_command tool to test commands before running them.');

    return recommendations;
  }
}
