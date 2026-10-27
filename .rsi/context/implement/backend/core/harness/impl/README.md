# Harness implementation context

## Result summary

Harness owns reusable tools, available capabilities, scope enforcement, execution resources, explicit Git approval and backend-owned maintenance prompts. Data definitions and related operations are aggregated under data/. Bash result feedback separates captured command output from execution metadata and recovery hints while preserving execution and permission behavior.

Design: [Harness](../../../../../design/backend/core/harness/design.md).

### Coordination and ownership

HarnessService obtains public member configuration and Workspace design/file information, resolves effective grants, and supplies tools/prompts to the Agent request assembled by Team. Native Pi read/search tools retain their implementations; write/edit gates use accepted scope. Custom Bash owns one member shell and sandbox policy. Team signals lifecycle cleanup. Prompts require maintaining shared implementation documents and explain continuous private context; documents/retrieval entries are not implicitly loaded/executed on activation. Agent owns compaction policy; Harness supplies the context-compaction instruction file without adding a context-management tool.

### Implemented contract

**Input:** Workspace/design services, a member lookup callback, custom web tools and the operator permission switch; prepare(memberId, additionalTools) and existing file/approval operations.

**Output:** Prepared RuntimeTool capabilities, context/rule prompts, scope inspection, tool results and approval requests/decisions.

**Effect and failure:** Preserves accepted recursive working scope, dependency reads, scoped write/edit, broad Bash resource policy, timeout/background-job lifecycle and explicit protected-commit approval. Operator bypass remains. Tool/file effects can survive failure; no checkpoint or replay is added.

**Usage example:** Construct HarnessService with WorkspaceService, DesignService and the member lookup. Call prepare(memberId) to obtain tools/context for a model request; invoke its returned RuntimeTool with Agent StepScope. Close member shells on lifecycle transitions.

### Bash result and timeout feedback

**Input:** The custom Bash tool receives `command`, optional `cwd`, `timeout` in seconds, `background` and metadata under its existing schema.

**Output:** Captured stdout/stderr is preserved as the body. One trailing `<metadata>` block carries tool status, exit/job information, errors and hints; empty output has no synthetic no-output body. Shell restart and truncation notices stay in the footer. Structured details retain the same facts and hint.

**Effect/failure:** A tool-enforced timeout returns `isError: true`, `error_code: tool_timeout`, the effective `timeout_seconds`, `background` and `timeout_phase`. Foreground guidance comes from `bash-timeout.md` and instructs explicit background retry with user-managed logs/jobs. A background launch deadline uses `bash-background-timeout.md` and the actual 10-second acknowledgment limit, not an explicit job lifetime. Command-reported network errors remain ordinary command output/exit failures, with no tool-timeout hint. Execution limits, cancellation, shell/job cleanup, permission modes and the agent loop are unchanged. No automatic retry is introduced.

**Usage:** `{"command":"npm install > install.log 2>&1","background":true}`; inspect the file and native job using later Bash calls. Prompt assets are copied by the existing build step.

**Verification:** 15 focused Bash session, tool-result and permission tests passed, including a real foreground timeout with retained output and command-reported network-error separation. Backend build passed; compiled prompt loading and both packaged timeout prompt assets were verified.

### Compaction instruction asset

harnessPrompt('context-compaction') loads required backend/prompts/harness/context-compaction.md. The build copies the complete harness prompt directory beside compiled code. The instruction describes the private replacement boundary, retention of every new assistant/tool message and separately supplied shared group context. It explicitly prohibits continuing ordinary work during preparation; file reads, workspace inspection and targeted verification preserve useful facts, while the final text retains conclusions, evidence, work already performed and Next steps without executing them. Runtime supplies this string in Agent compaction settings; Harness does not select a token threshold or persist compaction state.

The semantic-analysis Harness capability is implemented as `semanticSubmissionTool` and exposed only through `HarnessService.semanticTool` to the Team-created maintenance run. It validates the native tool input shape and forwards the typed submission to Team; Team, not Harness, validates source digests, tree structure, member IDs and authoritative involvement. The capability does not enter ordinary member tools, alter shared messages or publish responses. The context-compaction prompt is maintained separately as a release-owned instruction.

### Harness data model

**Input:** data/config.ts validates configured design scope; data/bases.ts and resources.ts define purpose/resource grants; data/model.ts defines resolved scopes/permissions/environment; data/bash.ts defines Bash input/output and parsing. data/approvals.ts owns pending CommitApproval values and ApprovalRequests list/read/decide/wait operations.

**Output/effect:** HarnessService.approvals is the same public inspection/decision surface backed by ApprovalRequests. GitCommitControl consumes that data interface for staged-tree validation and approved execution; it no longer stores approval state itself. Approvals and shell/job resources remain session-local and are cancelled/reset under existing lifecycle rules. No new durable Harness table or tool/input/output/permission policy is added.

**Usage example:** use harness.approvals.list(workspaceId), read(workspaceId,id) and decide(workspaceId,id,action,message). Git execution uses the same injected ApprovalRequests.wait mechanism, without changing the HTTP review contract.

### Semantic tool verification

`npm run check` and the full backend suite pass (231/231). The maintenance-only `submit_group_semantic_information` tool is exposed by Harness and is not added to ordinary member tool sets. Team remains responsible for source, revision and involvement validation.

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
