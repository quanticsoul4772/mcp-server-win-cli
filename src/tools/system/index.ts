/**
 * System Info Tools
 *
 * Tools for retrieving system information.
 */

import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { BaseTool } from '../base/BaseTool.js';

export { ReadCurrentDirectoryTool } from './ReadCurrentDirectoryTool.js';
export { GetCpuUsageTool } from './GetCpuUsageTool.js';
export { GetDiskSpaceTool } from './GetDiskSpaceTool.js';
export { ListProcessesTool } from './ListProcessesTool.js';

import { ReadCurrentDirectoryTool } from './ReadCurrentDirectoryTool.js';
import { GetCpuUsageTool } from './GetCpuUsageTool.js';
import { GetDiskSpaceTool } from './GetDiskSpaceTool.js';
import { ListProcessesTool } from './ListProcessesTool.js';

/**
 * Create all system info tools
 */
export function createSystemTools(container: ServiceContainer): BaseTool[] {
  return [
    new ReadCurrentDirectoryTool(container),
    new GetCpuUsageTool(container),
    new GetDiskSpaceTool(container),
    new ListProcessesTool(container),
  ];
}
