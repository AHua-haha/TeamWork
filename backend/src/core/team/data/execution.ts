export interface ActiveMemberRun {
    runId: string;
    exchangeId: string;
    workspaceId: string;
}
export interface MemberJob {
    runId: string;
    agentId: string;
    workspaceId: string;
}
/** Team's in-memory admission/finalization references; Agent owns the referenced execution. */
export class TeamExecutionData {
    private readonly active = new Map<string, ActiveMemberRun>();
    private readonly jobs = new Map<string, MemberJob>();
    isRunning(memberId: string) { return this.active.has(memberId); }
    activeRun(memberId: string) { const run = this.active.get(memberId); return run ? { ...run } : undefined; }
    admitted(agentId: string, runId: string, exchangeId: string, workspaceId: string) { this.active.set(agentId, { runId, exchangeId, workspaceId }); this.jobs.set(runId, { runId, agentId, workspaceId }); }
    published(memberId: string) { this.active.delete(memberId); }
    settled(memberId: string, runId: string) { if (this.active.get(memberId)?.runId === runId)
        this.active.delete(memberId); this.jobs.delete(runId); }
    workspaceBusy(workspaceId: string) { return [...this.jobs.values()].some(job => job.workspaceId === workspaceId) || [...this.active.values()].some(run => run.workspaceId === workspaceId); }
    workspaceJobs(workspaceId: string) { return [...this.jobs.values()].filter(job => job.workspaceId === workspaceId).map(job => ({ ...job })); }
}
