import { AgentClient, createAgent as createAgentRequest } from './agent-client.js';
import { ConfigClient } from './config-client.js';
import { ContextClient } from './context-client.js';
import { GroupClient } from './group-client.js';
import { WorkspaceClient } from './workspace-client.js';
import { apiFetch } from './transport.js';

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
  readonly context: ContextClient;

  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = apiFetch) {
    this.fetcher = fetcher;
    // Resource clients currently use the browser fetch implementation. Keep
    // construction centralized here while their endpoint implementations are
    // incrementally migrated to the shared transport.
    this.config = new ConfigClient(fetcher);
    this.workspace = new WorkspaceClient(fetcher);
    this.context = new ContextClient(fetcher);
  }

  async createAgent(): Promise<string> {
    return createAgentRequest(this.fetcher);
  }

  agent(agentId: string, options?: ConstructorParameters<typeof AgentClient>[1]): AgentClient {
    return new AgentClient(agentId, { ...options, fetcher: options?.fetcher ?? this.fetcher });
  }

  group(workspaceId: string): GroupClient {
    return new GroupClient(workspaceId, { fetcher: this.fetcher });
  }

}

export { AgentClient, ConfigClient, ContextClient, GroupClient, WorkspaceClient };
export * from './config-client.js';
export * from './workspace-client.js';
export * from './protocol.js';

/** Shared application instance; App and features use this same facade. */
export const backendClient = new BackendClient();
