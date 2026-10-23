<!-- Task implementation; promote with verified source. -->
# Team implementation context

## Result summary

Team owns membership, active configuration, shared chat/context, triggering/scheduling and construction of member context. TeamRuntime is the durable host for member and solo HTTP agents; TeamData owns durable application schemas/queries/migrations. Business systems do not each require persistence.

Design: [Team](../../../../../design/backend/core/team/design.md).

### Coordination and ownership

TeamRuntime prepares settings/admission and creates AgentExecution. It restores working context once after admission/preparation, then Agent maintains it in memory. Explicit caller replacements and publication feedback update the live execution through its public interface. It acknowledges message start/message/context/terminal events through TeamData. Persisted records precede visible completion. TeamData also implements Workspace's public persistence port. Existing atomic publication/reservation/admission and activation transactions stay together here. TeamRuntime owns database lease checks, failed finalization reporting, restart recovery, durable follow and the live execution registry.

### Implemented contract

**Input:** TeamData(MySqlStorage); TeamRuntime(store, configSource, policy, stream, {progressCapacity?,maxSteps?}); TeamSystem(store, workspaces, config, webTools?, permissionsEnabled?); existing member/chat/config/review operations.

**Output:** Durable run/message/config/workspace-context records, shared response timeline and final references, inspection/settings, run/history/delta follow and explicit revision/busy/persistence failures.

**Effect and failure:** Team owns its durable format, SQL mappings and cleanup; Agent owns the meaning of its public execution values. Active source bytes, retained failure ranges, history cursors and schemas are preserved. Whole-workspace idle activation, single-member execution, user Git approval and durable interrupted recovery remain. Solo agents retain their existing API without joining a member roster.

**Usage example:** const store = new TeamData(new MySqlStorage(databaseUrl)); await store.migrate(); const runtime = new TeamRuntime(store, config, configuredPolicy(), piModelStream(models)); await runtime.open(); await runtime.start(agentId, text); Follow through runtime.follow; close runs/workspaces before store.close().

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
