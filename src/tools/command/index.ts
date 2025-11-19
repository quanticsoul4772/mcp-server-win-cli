/**
 * Command Execution Tools
 *
 * Tools for executing commands and managing command history.
 */

import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { BaseTool } from '../base/BaseTool.js';

export { ExecuteCommandTool } from './ExecuteCommandTool.js';
export { ReadCommandHistoryTool } from './ReadCommandHistoryTool.js';
export { StartBackgroundJobTool } from './StartBackgroundJobTool.js';
export { GetJobStatusTool } from './GetJobStatusTool.js';
export { GetJobOutputTool } from './GetJobOutputTool.js';
export { ExecuteBatchTool } from './ExecuteBatchTool.js';

import { ExecuteCommandTool } from './ExecuteCommandTool.js';
import { ReadCommandHistoryTool } from './ReadCommandHistoryTool.js';
import { StartBackgroundJobTool } from './StartBackgroundJobTool.js';
import { GetJobStatusTool } from './GetJobStatusTool.js';
import { GetJobOutputTool } from './GetJobOutputTool.js';
import { ExecuteBatchTool } from './ExecuteBatchTool.js';

/**
 * Create all command execution tools
 */
export function createCommandTools(container: ServiceContainer): BaseTool[] {
  return [
    new ExecuteCommandTool(container),
    new ReadCommandHistoryTool(container),
    new StartBackgroundJobTool(container),
    new GetJobStatusTool(container),
    new GetJobOutputTool(container),
    new ExecuteBatchTool(container),
  ];
}
