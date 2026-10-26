import type { TeamRoster, WorkspaceClient } from '../../shared/backend-client/index.js';
export interface ChatTeamState { team: TeamRoster | null; loading: boolean; error: string | null; refresh(): Promise<void> }
/** On-demand roster only: no timers, inspection, or concurrent refreshes. */
export class ChatRoster {
  private state: Omit<ChatTeamState, 'refresh'> = { team: null, loading: true, error: null };
  private listeners = new Set<() => void>();
  private inflight?: Promise<void>;
  private disposed = false;
  constructor(private readonly workspaceId: string, private readonly api: Pick<WorkspaceClient, 'roster'>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  refresh = (): Promise<void> => {
    if (this.disposed) return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.inflight = this.api.roster(this.workspaceId).then(team => this.publish({ team, loading: false, error: null }))
      .catch(error => this.publish({ ...this.state, loading: false, error: error instanceof Error ? error.message : 'Team could not be read' }))
      .finally(() => { this.inflight = undefined; });
    return this.inflight;
  };
  private publish(state: typeof this.state) { if (!this.disposed) { this.state = state; for (const listener of this.listeners) listener(); } }
  dispose = () => { this.disposed = true; this.listeners.clear(); };
}
