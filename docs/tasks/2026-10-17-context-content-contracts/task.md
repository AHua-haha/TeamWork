# Context content and contract terminology

Status: complete
Task start commit: 87ed32d93aeda8fe1c33b514d955574c0713bb0d
Review boundaries: [Context content](drafts/workspace-agent/context-base/design.md), [Harness authority](drafts/workspace-agent/harness/design.md), [Workspace initialization](drafts/workspace-agent/workspace/design.md)

## Design outcomes

- [delivered] Two context-content parts organized by design: user-owned design and agent-maintained implementation context. Reusable knowledge remains separate/deferred.
- [delivered] Design has purpose/responsibilities/boundaries, Interface contract and constraints/specifications/requirements. Implemented contract explicitly documents Input, Output, Effect and Usage examples for actual exposed interfaces, including classes.
- [delivered] File-maintained harness prompts instruct agents to read relevant context, maintain contracts and continuation facts, and surface design/code/context mismatches.
- [delivered] New-workspace templates initialize root design and paired implementation context in one durable initial change.
- [delivered] Common file tools allow working-context edits and dependency-context reads only. Independent context Git scopes use existing agent semantic commits/checkpoints and shared committed history.

Current contracts: [Context](../../systems/workspace-agent/context-base/design.md), [Harness](../../systems/workspace-agent/harness/design.md), [Workspace](../../systems/workspace-agent/workspace/design.md).

## Decisions and open questions

Keep existing logical user/agent API roots and JSON design records. A design user/<path> pairs with Markdown agent/<lower-cased-path>.md, retaining the whole filename/extension to avoid collisions. Context path limits apply to the derived path. One context file per Git scope makes committed continuity independent of a member's other assignments. Scope IDs are impl-context- plus 16 SHA-256 hex characters of lower-case design identity; inspection and assembled prompts provide exact IDs/paths.

Design/member commits still require user acceptance. Implementation-code/context commits are independently agent-authorized. General Bash retains .rsi write protection; file tools and scoped Git provide context changes. Missing working-context files may be created by assigned agents using the documented outline. Missing dependency context does not grant write authority.

Content maintenance is provided by prompts rather than new semantic validators, special tools or a runtime maintenance loop. Member settings, activation, message streaming and frontend APIs remain unchanged. Member inspection labels the new scope as Implementation context. Original raw context HTTP/history still observes original-workspace files; agent worktree commits are not copied into that surface or existing peers. Existing members retain their current pending files/bases. New members inherit committed paired context through existing shared scope refs; stale commits refuse.

Superseded: the earlier three-part knowledge/work-state proposal, separate knowledge.md/work.md tree, and the documentation-only checkpoint's open file-layout choices. Relevant unfinished work can be recorded within implementation context. These are application rules; repository development-protocol requirements are unchanged.

Deferred: reusable knowledge organization, automatic context publication/merge/peer refresh and maintenance scheduling. Existing workspaces are not reset or migrated. No remaining decision blocks this increment.

## Checkpoints and remaining work

Earlier checks recorded documentation-only persistence before implementation authorization. This increment implements and promotes the agreed prototype with updated context, harness, workspace, design-part, team, database and frontend inspection documentation. The matching drafts are retained as the completed task record. [Test evidence](tests.jsonl) includes focused authority/history tests, the complete backend unit/HTTP suite, disposable MySQL integration, backend build, prompt-asset packaging and document consistency checks.

The only frontend change labels new context scopes correctly in existing member inspection; the runtime loop is unchanged. Preserve unrelated .claude/, backend/.DS_Store and backend/prompts/.DS_Store. No push or merge is included. Restart the backend to load changed prompt files; compiled deployments require rebuilding first.

Final verification: 112 backend unit/HTTP tests and 45 disposable MySQL integration tests passed, with no skips in the final runs. Backend and frontend production builds, packaged prompt loading/value rendering and the 12-document draft/canonical audit passed. Frontend build retains its existing bundle-size advisory.
