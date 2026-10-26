import { WorkspaceClient, type WorkspaceChanges, type MemberConfigurationReview } from './workspace-client.js';

export type ChangeOperation = 'activate';
export interface ChangesSnapshot {
  view: WorkspaceChanges | null; loading: boolean; error: string | null;
  operation: ChangeOperation | null; operationError: string | null; notice: string | null;
  activation: MemberConfigurationReview | null; activationLoading: boolean; activationError: string | null;
}
type Api = Pick<WorkspaceClient, 'changes' | 'committedMemberReview' | 'activateMemberConfiguration'>;
const message = (error: unknown) => error instanceof Error ? error.message : 'Changes could not be read';

/** One file review in flight; activation validation never blocks its display. */
export class ChangesClient {
  private snapshot: ChangesSnapshot = { view: null, loading: false, error: null, operation: null, operationError: null, notice: null, activation: null, activationLoading: false, activationError: null };
  private listeners = new Set<() => void>();
  private inflight?: Promise<void>;
  private disposed = false;
  private validationKey = '';
  private validationGeneration = 0;
  constructor(private readonly workspaceId: string, private readonly api: Api = new WorkspaceClient()) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Partial<ChangesSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }
  refresh = (): Promise<void> => {
    if (this.disposed || this.snapshot.operation) return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.publish({ loading: true });
    const request = this.api.changes(this.workspaceId).then(view => {
      if (this.disposed) return;
      this.publish({ view, error: null });
      this.validateActivation(view);
    }).catch(error => { this.publish({ error: message(error) }); }).finally(() => {
      this.inflight = undefined;
      this.publish({ loading: false });
    });
    this.inflight = request;
    return request;
  };
  private validateActivation(view: WorkspaceChanges) {
    const key = JSON.stringify([view.design.base, view.members.base, view.activation.activeRevision]);
    if (key === this.validationKey && (this.snapshot.activationLoading || this.snapshot.activation)) return;
    this.validationKey = key;
    const generation = ++this.validationGeneration;
    if (!view.activation.hasChanges) {
      this.publish({ activation: null, activationLoading: false, activationError: null });
      return;
    }
    this.publish({ activation: null, activationLoading: true, activationError: null });
    void this.api.committedMemberReview(this.workspaceId).then(activation => {
      if (this.disposed || generation !== this.validationGeneration) return;
      if (activation.revision !== view.activation.revision) throw new Error('Approved member configuration changed; refresh the review.');
      this.publish({ activation, activationError: null });
    }).catch(error => {
      if (generation === this.validationGeneration) this.publish({ activationError: message(error) });
    }).finally(() => {
      if (generation === this.validationGeneration) this.publish({ activationLoading: false });
    });
  }
  async perform(kind: ChangeOperation): Promise<boolean> {
    const { view, activation } = this.snapshot;
    if (this.disposed || !view || this.snapshot.loading || this.snapshot.operation) return false;
    if (kind === 'activate' && (!view.activation.hasChanges || !activation?.valid || this.snapshot.activationLoading)) return false;
    this.validationKey = '';
    this.validationGeneration++;
    this.publish({ operation: kind, operationError: null, notice: null });
    let success = false;
    try {
      await this.api.activateMemberConfiguration(this.workspaceId, { revision: activation!.revision, digest: activation!.digest });
      success = true;
      this.publish({ notice: 'Committed members activated.' });
    } catch (error) { this.publish({ operationError: message(error) }); }
    finally {
      this.publish({ operation: null });
      await this.refresh();
    }
    return success;
  }
  dispose() { this.disposed = true; this.validationGeneration++; this.listeners.clear(); }
}
