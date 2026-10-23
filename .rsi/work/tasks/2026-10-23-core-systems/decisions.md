# Migration decisions

Persistence is optional for a business system. The reusable AgentExecution owns one in-memory run, context and progress and accepts an optional caller observer. It imports no SQL adapter, durable codec or Team implementation. Without the observer it runs directly in memory.

AgentObserver acknowledges message start, completed message, context replacement and terminal state. TeamRuntime supplies these acknowledgements with TeamData operations; the run waits before dependent steps/progress completion. TeamRuntime also owns database ownership, recovery, durable inspection/follow, admission and the live execution registry. TeamData retains the existing atomic SQL workflows and stored formats. Solo HTTP agents use the same durable TeamRuntime host and remain outside member rosters.

Workspace keeps public registry/context change contracts, file content/index/model validation and management. Its persistence port is injected; TeamData implements that durable port using Workspace public values. Workspace does not depend on MySQL. The parent Core bootstrap combines Workspace context and Team lead source before atomic registration. Harness owns tool capability and maintenance prompts, which remain backend-owned Markdown assets.

This increment establishes four child boundaries. It does not further subdivide Team persistence, add repositories for each table, change HTTP payloads, reset data, activate configurations or deploy. Internal TypeScript imports move to the new owner paths; the old AgentRuntime/CoreData names become TeamRuntime/TeamData, and AgentExecution is the reusable in-memory entry.

After first-step context preparation, Team restores the public working snapshot once. Subsequent model steps use Agent memory; there is no unconditional SQL context reload per step. Explicit host context replacement and feedback update the live Agent through its interface. Agent context-change notifications persist revisions before acknowledgement.

AgentConfiguration contains execution inputs only. Configuration revisions/provenance and RunConfigSource belong to the Team host. A standalone Agent caller supplies no database/config-record revision metadata.
