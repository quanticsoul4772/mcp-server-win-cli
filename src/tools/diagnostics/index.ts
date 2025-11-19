/**
 * Diagnostic Tools
 *
 * Tools for troubleshooting and inspecting server configuration.
 */

import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { BaseTool } from '../base/BaseTool.js';

export { CheckSecurityConfigTool } from './CheckSecurityConfigTool.js';
export { ValidateCommandTool } from './ValidateCommandTool.js';
export { ExplainExitCodeTool } from './ExplainExitCodeTool.js';
export { ValidateConfigTool } from './ValidateConfigTool.js';
export { ReadSystemInfoTool } from './ReadSystemInfoTool.js';
export { TestConnectionTool } from './TestConnectionTool.js';
export { ReadEnvironmentVariableTool } from './ReadEnvironmentVariableTool.js';
export { ListEnvironmentVariablesTool } from './ListEnvironmentVariablesTool.js';
export { GetConfigValueTool } from './GetConfigValueTool.js';
export { ReloadConfigTool } from './ReloadConfigTool.js';
export { DnsLookupTool } from './DnsLookupTool.js';
export { TestConnectivityTool } from './TestConnectivityTool.js';

import { CheckSecurityConfigTool } from './CheckSecurityConfigTool.js';
import { ValidateCommandTool } from './ValidateCommandTool.js';
import { ExplainExitCodeTool } from './ExplainExitCodeTool.js';
import { ValidateConfigTool } from './ValidateConfigTool.js';
import { ReadSystemInfoTool } from './ReadSystemInfoTool.js';
import { TestConnectionTool } from './TestConnectionTool.js';
import { ReadEnvironmentVariableTool } from './ReadEnvironmentVariableTool.js';
import { ListEnvironmentVariablesTool } from './ListEnvironmentVariablesTool.js';
import { GetConfigValueTool } from './GetConfigValueTool.js';
import { ReloadConfigTool } from './ReloadConfigTool.js';
import { DnsLookupTool } from './DnsLookupTool.js';
import { TestConnectivityTool } from './TestConnectivityTool.js';

/**
 * Create all diagnostic tools
 */
export function createDiagnosticTools(container: ServiceContainer): BaseTool[] {
  return [
    new CheckSecurityConfigTool(container),
    new ValidateCommandTool(container),
    new ExplainExitCodeTool(container),
    new ValidateConfigTool(container),
    new ReadSystemInfoTool(container),
    new TestConnectionTool(container),
    new ReadEnvironmentVariableTool(container),
    new ListEnvironmentVariablesTool(container),
    new GetConfigValueTool(container),
    new ReloadConfigTool(container),
    new DnsLookupTool(container),
    new TestConnectivityTool(container),
  ];
}
