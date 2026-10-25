# Harness implementation context

## Result summary

Harness owns reusable tools, available capabilities, scope enforcement, execution resources, explicit Git approval and backend-owned maintenance prompts. Its tool and permission behavior is unchanged; data definitions and related operations are now aggregated under data/.

Design: [Harness](../../../../../design/backend/core/harness/design.md).

### Coordination and ownership

HarnessService obtains public member configuration and Workspace design/file information, resolves effective grants, and supplies tools/prompts to the Agent request assembled by Team. Native Pi read/search tools retain their implementations; write/edit gates use accepted scope. Custom Bash owns one member shell and sandbox policy. Team signals lifecycle cleanup. Prompts require maintaining shared implementation documents and explain continuous private context; documents/retrieval entries are not implicitly loaded/executed on activation. Agent owns compaction policy; Harness supplies the context-compaction instruction file without adding a context-management tool.

### Implemented contract

**Input:** Workspace/design services, a member lookup callback, custom web tools and the operator permission switch; prepare(memberId, additionalTools) and existing file/approval operations.

**Output:** Prepared RuntimeTool capabilities, context/rule prompts, scope inspection, tool results and approval requests/decisions.

**Effect and failure:** Preserves accepted recursive working scope, dependency reads, scoped write/edit, broad Bash resource policy, timeout/background-job lifecycle and explicit protected-commit approval. Operator bypass remains. Tool/file effects can survive failure; no checkpoint or replay is added.

**Usage example:** Construct HarnessService with WorkspaceService, DesignService and the member lookup. Call prepare(memberId) to obtain tools/context for a model request; invoke its returned RuntimeTool with Agent StepScope. Close member shells on lifecycle transitions.

### Compaction instruction asset

harnessPrompt('context-compaction') loads required backend/prompts/harness/context-compaction.md. The build copies the complete harness prompt directory beside compiled code. The instruction describes the private replacement boundary, retention of every new assistant/tool message, separately preserved original group context and Next steps for unfinished work. Runtime supplies this string in Agent compaction settings; Harness does not select a token threshold or persist compaction state.

### Harness data model

**Input:** data/config.ts validates configured design scope; data/bases.ts and resources.ts define purpose/resource grants; data/model.ts defines resolved scopes/permissions/environment; data/bash.ts defines Bash input/output and parsing. data/approvals.ts owns pending CommitApproval values and ApprovalRequests list/read/decide/wait operations.

**Output/effect:** HarnessService.approvals is the same public inspection/decision surface backed by ApprovalRequests. GitCommitControl consumes that data interface for staged-tree validation and approved execution; it no longer stores approval state itself. Approvals and shell/job resources remain session-local and are cancelled/reset under existing lifecycle rules. No new durable Harness table or tool/input/output/permission policy is added.

**Usage example:** use harness.approvals.list(workspaceId), read(workspaceId,id) and decide(workspaceId,id,action,message). Git execution uses the same injected ApprovalRequests.wait mechanism, without changing the HTTP review contract.

### Workspace deletion resources

**Input:** Existing HarnessService.closeShells(memberIds), called by the confirmed idle workspace-deletion flow after durable removal.

**Output:** Completion after the selected member shells and background jobs stop.

**Effect and failure:** Reuse resetMemberShell to terminate process groups and Git broker sessions; preserve all project/.rsi files. No tool schema/permission policy or filesystem cleanup capability is added. Application-data refusal occurs before resource cleanup.

**Usage example:** TeamSystem captures all member IDs, deletes application data, then closes their shell sessions. The deletion regression test launches a native sleep job, deletes the workspace, verifies that PID is gone and compares every project file byte-for-byte.

## File lookup

- [backend/src/core/harness/data](../../../../../../../backend/src/core/harness/data): scope, tool input and approval model operations.

- [backend/src/core/harness](../../../../../../../backend/src/core/harness): owned source.
- [reference/web-tools/design.md](reference/web-tools/design.md): detailed existing behavior and code map.
- [reference/web-tools/impl.md](reference/web-tools/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/harness/design.md](reference/workspace-agent/harness/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/harness/impl.md](reference/workspace-agent/harness/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/harness/tools/bash/design.md](reference/workspace-agent/harness/tools/bash/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/harness/tools/bash/impl.md](reference/workspace-agent/harness/tools/bash/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/harness/tools/design.md](reference/workspace-agent/harness/tools/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/harness/tools/impl.md](reference/workspace-agent/harness/tools/impl.md): detailed existing behavior and code map.
- [Backend tests](../../../../../../../backend/test): unit/HTTP, in-memory execution, boundary and disposable SQL integration checks.

## Automatic retrieval

```json
{"commands": []}
```
