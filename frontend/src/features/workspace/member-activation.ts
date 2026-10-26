import type { MemberConfigurationReview, WorkspaceClient } from '../../shared/backend-client/index.js';
export interface ActivationState { review: MemberConfigurationReview | null; busy: 'check' | 'activate' | null; error: string | null; notice: string | null }
/** Explicit user actions only. Never loads file diffs or polls in the background. */
export class MemberActivation {
  private state: ActivationState = { review: null, busy: null, error: null, notice: null };
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(private readonly workspaceId: string, private readonly api: Pick<WorkspaceClient, 'committedMemberReview' | 'activateMemberConfiguration'>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Partial<ActivationState>) { if (!this.disposed) { this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); } }
  async check() {
    if (this.disposed || this.state.busy) return;
    this.publish({busy: 'check', review: null, error: null, notice: null});
    try { this.publish({review: await this.api.committedMemberReview(this.workspaceId)}); }
    catch(error) { this.publish({error: error instanceof Error ? error.message : 'Committed members could not be checked'}); }
    finally { this.publish({busy: null}); }
  }
  async activate(): Promise<boolean> {
    const review = this.state.review;
    if (this.disposed || this.state.busy || !review?.valid || review.changes?.length === 0) return false;
    this.publish({busy: 'activate', error: null, notice: null});
    try {
      await this.api.activateMemberConfiguration(this.workspaceId, {revision: review.revision, digest: review.digest});
      this.publish({review: null, notice: 'Committed members activated.'});
      return true;
    } catch(error) {
      this.publish({review: null, error: error instanceof Error ? error.message : 'Member activation failed'});
      return false;
    } finally { this.publish({busy: null}); }
  }
  dispose = () => { this.disposed = true; this.listeners.clear(); };
}
