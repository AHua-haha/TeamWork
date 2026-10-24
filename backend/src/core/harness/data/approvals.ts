import type { FileChange } from '../../workspace/workspace-git.js';
import { AppError } from '../../errors.js';
export interface CommitApproval {
    id: string;
    workspaceId: string;
    memberId: string;
    runId: string | null;
    command: string;
    directory: string;
    message: string;
    createdAt: number;
    changes: FileChange[];
}
export type ApprovalDecision = 'accept' | 'deny' | 'feedback';
type Pending = {
    view: CommitApproval;
    resolve: (decision: {
        action: ApprovalDecision;
        message: string;
    }) => void;
};
/** Session-bound pending tool decisions. Restart cancels execution, never replays it. */
export class ApprovalRequests {
    private pending = new Map<string, Pending>();
    list(workspaceId: string) { return [...this.pending.values()].filter(p => p.view.workspaceId === workspaceId).map(({ view: { changes: _, ...view } }) => view); }
    read(workspaceId: string, id: string) { const entry = this.pending.get(id); if (!entry || entry.view.workspaceId !== workspaceId)
        throw new AppError('not_found', 'Commit approval is no longer pending', 404); return entry.view; }
    decide(workspaceId: string, id: string, action: unknown, message: unknown = '') {
        this.read(workspaceId, id);
        if (!['accept', 'deny', 'feedback'].includes(action as string) || typeof message !== 'string' || message.length > 10000 || (action === 'feedback' && !message.trim()))
            throw new AppError('invalid_input', 'Choose accept, deny or feedback; feedback requires a message');
        const entry = this.pending.get(id)!;
        this.pending.delete(id);
        entry.resolve({ action: action as ApprovalDecision, message });
        return { resolved: true };
    }
    wait(view: CommitApproval, signal: AbortSignal, onWait: (waiting: boolean) => void) {
        signal.throwIfAborted();
        onWait(true);
        let abort = () => { };
        return new Promise<{
            action: ApprovalDecision;
            message: string;
        }>((resolveDecision, reject) => {
            abort = () => { this.pending.delete(view.id); reject(new AppError('approval_cancelled', 'Commit approval cancelled; no commit was executed', 409)); };
            signal.addEventListener('abort', abort, { once: true });
            this.pending.set(view.id, { view, resolve: resolveDecision });
            if (signal.aborted)
                abort();
        }).finally(() => { signal.removeEventListener('abort', abort); this.pending.delete(view.id); onWait(false); });
    }
}
