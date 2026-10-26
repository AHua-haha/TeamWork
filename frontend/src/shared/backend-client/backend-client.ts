import { AgentClient, createAgent as createAgentRequest } from './agent-client.js';
import { ChangesClient } from './changes-client.js';
import { ConfigClient } from './config-client.js';
import { GroupClient } from './group-client.js';
import { WorkspaceClient } from './workspace-client.js';

/**
 * The single frontend boundary for backend communication.
 *
 * Resource clients remain decomposed internally so transport code stays
 * maintainable, but application features receive this facade rather than
 * constructing independent backend client configurations.
 */
export class BackendClient {
  readonly config: ConfigClient;
  readonly workspace: WorkspaceClient;

  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    // Resource clients currently use the browser fetch implementation. Keep
    // construction centralized here while their endpoint implementations are
    // incrementally migrated to the shared transport.
    this.config = new ConfigClient(fetcher);
    this.workspace = new WorkspaceClient();
  }

  async createAgent(): Promise<string> {
    return createAgentRequest();
  }

  agent(agentId: string, options?: ConstructorParameters<typeof AgentClient>[1]): AgentClient {
    return new AgentClient(agentId, options);
  }

  group(workspaceId: string): GroupClient {
    return new GroupClient(workspaceId);
  }

  changes(workspaceId: string): ChangesClient {
    return new ChangesClient(workspaceId, this.workspace);
  }
}

export { AgentClient, ChangesClient, ConfigClient, GroupClient, WorkspaceClient };
export * from './config-client.js';
export * from './workspace-client.js';
export * from './protocol.js';

/** Shared application instance; App and features use this same facade. */
export const backendClient = new BackendClient();
