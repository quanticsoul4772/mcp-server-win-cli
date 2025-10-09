import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import { deleteSSHConnection } from '../../utils/sshManager.js';

interface DeleteSSHConnectionArgs {
  connectionId: string;
}

/**
 * DeleteSSHConnectionTool
 *
 * Deletes an SSH connection from the configuration file.
 */
export class DeleteSSHConnectionTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'delete_ssh_connection',
      '[SSH Operations] Delete an existing SSH connection',
      'SSH Operations'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        connectionId: {
          type: 'string',
          description: 'ID of the SSH connection to delete'
        }
      },
      required: ['connectionId']
    };
  }

  async execute(args: DeleteSSHConnectionArgs): Promise<ToolResult> {
    const { connectionId } = args;

    try {
      await deleteSSHConnection(connectionId);
      return this.success(`Successfully deleted SSH connection '${connectionId}'`);
    } catch (error) {
      return this.error(
        `Failed to delete SSH connection: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
