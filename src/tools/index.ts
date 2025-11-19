/**
 * MCP Tools Index
 *
 * Exports all tool implementations organized by category.
 */

import type { ServiceContainer } from '../server/ServiceContainer.js';
import type { BaseTool } from './base/BaseTool.js';
import { createCommandTools } from './command/index.js';
import { createSSHTools } from './ssh/index.js';
import { createDiagnosticTools } from './diagnostics/index.js';
import { createSystemTools } from './system/index.js';

// Command Execution Tools
export * from './command/index.js';

// SSH Operations Tools
export * from './ssh/index.js';

// Diagnostic Tools
export * from './diagnostics/index.js';

// System Info Tools
export * from './system/index.js';

// Base Tool Classes
export * from './base/BaseTool.js';
export * from './base/types.js';

/**
 * Create all MCP tools for registration
 *
 * @param container - ServiceContainer for dependency injection
 * @returns Array of all tool instances (34 tools total)
 */
export function createAllTools(container: ServiceContainer): BaseTool[] {
  return [
    ...createCommandTools(container),
    ...createSSHTools(container),
    ...createDiagnosticTools(container),
    ...createSystemTools(container),
  ];
}
