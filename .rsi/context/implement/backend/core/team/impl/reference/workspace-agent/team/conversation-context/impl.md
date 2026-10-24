# Continuous conversation context implementation

## Contract

Team provides only GroupContextReference; Agent owns incorporation and continuous context. AgentRuntime and AgentData own durable execution/context; Team supplies shared data and coordination only. See the linked owning contracts and code.

## Data flow and implemented interfaces

1. TeamSystem.policy.groupContext(agentId) returns {id: workspaceId, read: after => store.readGroupContext(workspaceId, after)}. No admission-through/retention position is supplied.
2. AgentRuntime acquires execution authority and restores agents.context once. AgentExecution uses AgentMessageContext.incoming to choose after from existing entry metadata and propose new entries. Optional observer.contextChanged acknowledges CAS replacement before dependent work.
3. Group entries include groupContextId, groupPosition and groupMessageId. These markers and message content are one persisted context snapshot, without a separate processed-prefix table. Native pictures remain content blocks. Own finals retain their original assistant blocks and add sender/provenance without duplicating the answer.
4. No shared input is inserted between model/tool steps. After pending work/afterRun settles, Agent catches up through its reference before the host finishes. Unmentioned idle members use the same Agent context owner through runtime.syncGroupContext, without model calls.
5. Message commits append immutable history and current context. Terminal state does not clear current context. Startup interrupts abandoned runs; the next synchronization repairs missing tool results without replay. Explicit reset deletes context/history together and preserves project documents.

## Migration and failures

A backend context_format marker makes legacy adoption once-only. Agent's adoption helper combines recorded private work and original shared messages, keeping tool/result groups intact. SQL persists the resulting snapshot/marker transactionally, then retires legacy member_contexts/member_context_runs. It never edits stable history or project files. Old per-run document parsing, retrieval and success/failure retention rules are removed.

Context persistence refusal prevents acknowledged consumption advancement. Idle synchronization failures remain observable via runtime.getState; later successful synchronization or activation can recover. External effects are never automatically replayed. Compaction lifecycle, immutable preparation records and CAS cutover are persisted by AgentData; see the owning Agent implementation context. Preparation recovery runs before ordinary interruption recovery, including for already published responses.

## Code and verification

- [Agent context ownership and legacy adoption](../../../../../../../../../../../backend/src/core/agent/data/context.ts)
- [Execution boundaries and acknowledgements](../../../../../../../../../../../backend/src/core/agent/agent.ts)
- [Durable host and original group reads](../../../../../../../../../../../backend/src/core/data.ts)
- [Read reference policy](../../../../../../../../../../../backend/src/core/team/team-system.ts)
- [Restoration and idle synchronization](../../../../../../../../../../../backend/src/core/agent/runtime.ts)
- [Publication and synchronization notification](../../../../../../../../../../../backend/src/core/team/team-runner.ts)
- [Implementation maintenance instructions](../../../../../../../../../../../backend/prompts/harness/implementation.md)
- [Context ownership tests](../../../../../../../../../../../backend/test/conversation-context.test.ts)
- [In-memory execution and acknowledgement tests](../../../../../../../../../../../backend/test/agent-execution.test.ts)
- [Disposable MySQL/restart/migration/reset/image tests](../../../../../../../../../../../backend/test/integration/backend.test.ts)
