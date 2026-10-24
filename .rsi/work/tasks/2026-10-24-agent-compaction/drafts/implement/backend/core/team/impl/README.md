> Proposed for task 2026-10-24-agent-compaction; delivered with its source.

# Team implementation context

## Result summary

Team owns authoritative original group messages, membership/cooperation and durable application state. TeamRuntime hosts AgentExecution; TeamData maps public context/history values to SQL. Consumption and private-retention semantics belong to Agent.

Design: [Team](../../../../../design/backend/core/team/design.md).

### Coordination and ownership

TeamSystem.policy supplies only a group-context reference. TeamData.readGroupContext(workspaceId, after) resolves the original shared inputs, authoritative sender text, native pictures and final origins in one repeatable-read snapshot. Agent selects after. TeamRuntime restores context once after execution admission and acknowledges Agent context changes. TeamRunner notifies idle members after publication through syncGroupContext; busy/queued workers synchronize at their Agent work boundary. No implicit document loading/retrieval or terminal context clearing remains.

### Implemented contract

**Input:** TeamData(MySqlStorage), TeamRuntime(store, configSource, policy, stream, limits?), TeamSystem(store, workspaces, config, webTools?, permissionsEnabled?). Existing member/chat/review/settings operations are unchanged. syncGroupContext(agentId) schedules idle context synchronization; Agent callbacks acknowledge completed messages, context replacements and terminal state.

**Output:** Existing HTTP/SSE history/timeline/progress envelopes. readGroupContext returns Agent GroupContextMessage values including prepared image blocks and optional private-final origin. SQL getContext/replaceContext returns/acknowledges the Agent-owned snapshot, including its incorporation markers.

**Effect and failure:** SQL CAS replacement stores the full context and incorporation state atomically. Private completed history, shared final references and UI working-history ranges remain independent. Publication finalizes sender and reserves recipient runs atomically but does not clear context or freeze a context-retention boundary. Idle synchronization failures are retained for getState to report as persistence_failure; a subsequent synchronization or admitted run can restore context. Startup interrupts abandoned runs without replay. Explicit idle reset clears contexts and histories while preserving project files. Other member/config/workspace persistence responsibilities remain.

**Usage example:** Create TeamData and TeamRuntime, attach TeamSystem and open. Publish via team.runner.postUser; the runner schedules mentioned members and synchronizes unmentioned idle members without model calls. Call runtime.finished to await work and context finalization; read stable history through existing APIs.

### Durable transition

agents.context_format is a backend migration marker. Fresh rows use 1. When upgrading an older schema, existing rows receive 0 and member records are adopted once using Agent's public adoption procedure with recorded private history and resolved shared context. The updated snapshot/format marker commit together. Successful retries skip completed rows. Old member_contexts/member_context_runs tables are dropped after adoption; ordinary execution no longer uses success_position, group_through or retained-range selection. Stable history/project files are not deleted. A restored historical context can be larger; configured Agent compaction now handles its private continuation at the next applicable checkpoint.

### Durable compaction hosting

**Input:** TeamRuntime options.compaction?: {thresholdTokens,prompt}; validated once and supplied to Agent. TeamData.beginCompaction(state), commitCompactionMessage(record), finishCompaction(state,revision,entries), recoverCompactions(). The Agent chooses trigger, retained trace and shared coverage. Low-level callers can omit settings; managed Runtime supplies them.

**Storage/effect:** context_compactions stores the lifecycle JSON, owning agent/run, history_after and nullable unique active_agent_id. begin locks the agent and records the immutable-history boundary. Tentative messages tagged source=context-compaction and compactionId append to messages and advance history_position without changing agents.context. finish replaces context under revision CAS and marks the journal terminal in one transaction. The run may already be completed by final publication; maintenance is part of its private lifetime, never a new run/mention. finalText excludes preparation messages; public finalRef/endPosition/working ranges stay pinned to accepted ordinary output. No private preparation chunks are emitted as ordinary live output. Before-call preparation records can appear in private working history.

**Failure/recovery:** Startup recovers preparing journals before interrupted ordinary runs, using Agent’s recovery composer. Preserve old context and recorded preparation, repair unknown tool outcomes, mark failed/runtime_restarted and never execute tools. Atomic cutover refusal rolls back context and lifecycle together. An uncertain lifecycle/message/cutover acknowledgement surfaces as persistence_failure even if the ordinary run is already completed, leaving its journal for startup recovery. Stop includes finalizing jobs even after publication; idle reset/activation waits for them. Chat/admin reset deletes journals before message/run owners.

**Usage example:** new TeamRuntime(store,source,policy,stream,{compaction:{thresholdTokens:64000,prompt}}). open() acquires runtime ownership then recovers journals/runs. runtime.finished(agentId,runId) waits for private maintenance; stable shared publication remains readable during it.

## File lookup

- [backend/src/core/team](../../../../../../../backend/src/core/team): owned source.
- [reference/config/design.md](reference/config/design.md): detailed existing behavior and code map.
- [reference/config/impl.md](reference/config/impl.md): detailed existing behavior and code map.
- [reference/database/design.md](reference/database/design.md): detailed existing behavior and code map.
- [reference/database/impl.md](reference/database/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/conversation-context/design.md](reference/workspace-agent/team/conversation-context/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/conversation-context/impl.md](reference/workspace-agent/team/conversation-context/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/design.md](reference/workspace-agent/team/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/group-chat/design.md](reference/workspace-agent/team/group-chat/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/group-chat/impl.md](reference/workspace-agent/team/group-chat/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/impl.md](reference/workspace-agent/team/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/lead/design.md](reference/workspace-agent/team/lead/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/lead/impl.md](reference/workspace-agent/team/lead/impl.md): detailed existing behavior and code map.
- [Backend tests](../../../../../../../backend/test): unit/HTTP, in-memory execution, boundary and disposable SQL integration checks.

## Automatic retrieval

```json
{"commands": []}
```
