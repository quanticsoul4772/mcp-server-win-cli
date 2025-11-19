/**
 * SSH Operations Tools
 *
 * Tools for managing SSH connections and executing remote commands.
 */

import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { BaseTool } from '../base/BaseTool.js';

export { SSHExecuteTool } from './SSHExecuteTool.js';
export { SSHDisconnectTool } from './SSHDisconnectTool.js';
export { CreateSSHConnectionTool } from './CreateSSHConnectionTool.js';
export { ReadSSHConnectionsTool } from './ReadSSHConnectionsTool.js';
export { UpdateSSHConnectionTool } from './UpdateSSHConnectionTool.js';
export { DeleteSSHConnectionTool } from './DeleteSSHConnectionTool.js';
export { ReadSSHPoolStatusTool } from './ReadSSHPoolStatusTool.js';
export { ValidateSSHConnectionTool } from './ValidateSSHConnectionTool.js';
export { SFTPUploadTool } from './SFTPUploadTool.js';
export { SFTPDownloadTool } from './SFTPDownloadTool.js';
export { SFTPListDirectoryTool } from './SFTPListDirectoryTool.js';
export { SFTPDeleteFileTool } from './SFTPDeleteFileTool.js';

import { SSHExecuteTool } from './SSHExecuteTool.js';
import { SSHDisconnectTool } from './SSHDisconnectTool.js';
import { CreateSSHConnectionTool } from './CreateSSHConnectionTool.js';
import { ReadSSHConnectionsTool } from './ReadSSHConnectionsTool.js';
import { UpdateSSHConnectionTool } from './UpdateSSHConnectionTool.js';
import { DeleteSSHConnectionTool } from './DeleteSSHConnectionTool.js';
import { ReadSSHPoolStatusTool } from './ReadSSHPoolStatusTool.js';
import { ValidateSSHConnectionTool } from './ValidateSSHConnectionTool.js';
import { SFTPUploadTool } from './SFTPUploadTool.js';
import { SFTPDownloadTool } from './SFTPDownloadTool.js';
import { SFTPListDirectoryTool } from './SFTPListDirectoryTool.js';
import { SFTPDeleteFileTool } from './SFTPDeleteFileTool.js';

/**
 * Create all SSH operations tools
 */
export function createSSHTools(container: ServiceContainer): BaseTool[] {
  return [
    new SSHExecuteTool(container),
    new SSHDisconnectTool(container),
    new CreateSSHConnectionTool(container),
    new ReadSSHConnectionsTool(container),
    new UpdateSSHConnectionTool(container),
    new DeleteSSHConnectionTool(container),
    new ReadSSHPoolStatusTool(container),
    new ValidateSSHConnectionTool(container),
    new SFTPUploadTool(container),
    new SFTPDownloadTool(container),
    new SFTPListDirectoryTool(container),
    new SFTPDeleteFileTool(container),
  ];
}
