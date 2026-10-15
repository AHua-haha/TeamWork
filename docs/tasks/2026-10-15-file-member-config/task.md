# File-based member configuration and purpose harnesses

Status: complete
Task start commit: 2234245052a40f500332aa9b8a1ce70b96bdd6c7
Review boundaries: [Harness](drafts/workspace-agent/harness/design.md), [Team](drafts/workspace-agent/team/design.md), [Lead](drafts/workspace-agent/team/lead/design.md)

## Design outcomes
- [delivered] Two fixed purpose bases: design management and implementation; only design references and explicit implementation/use paths are configurable.
- [delivered] Common file editing plus one path-only submit tool, strict whole-bundle validation and durable last accepted bundle including Markdown prompts.
- [delivered] Command boundary harness remains deferred; existing command allowances/execution are retained, outside editable purpose assignments.

## Decisions and open questions
JSON manifests and bundle-relative Markdown prompt files. The fixed lead management authority delegates within its workspace, excluding reserved control paths. Workers cannot submit member configuration. Submission refuses a busy target; a lead cannot change its own configuration while running. User HTTP settings edits produce an accepted file bundle through the same persistence path. Legacy member settings migrate once to explicit scopes, preserving prior permissions; runtime never derives grants from changing design mappings afterward. Prompt files contain member instructions; fixed harness rules are backend-owned and cannot be replaced through the manifest.

## Checkpoints and remaining work
Delivered in this task-tagged commit: two fixed bases, explicit design/implementation assignments, file submission with exact durable source bundles, Markdown prompts, strict scope/model/policy validation, atomic idle/revision guards, and stable bundle reads. Structured agent creation/update/configuration paths were removed. Existing inspector and settings transport reflect the explicit implementation scope. Startup freezes old mappings and projects Git scope exclusions without resetting accepted or pending files; prior references remain retained.

Verification of the final candidate: 78 backend unit/HTTP tests, 38 disposable MySQL integration tests, 47 frontend tests, both builds, and 16-file documentation parity/link/whitespace audit passed. The log includes the earlier failed type checks and whitespace audit and their successful corrections. A trailing blank-line correction in the lead test was followed by its targeted regression run. Later backend model-validation changes were followed by the full backend build/unit/MySQL checks again. See [test evidence](tests.jsonl).

Command-boundary harness/configuration, configuration editing UI, accepted-design publishing into the original catalog, and automatic worktree integration remain deferred. New members inherit the lead's current command allowances; submissions preserve existing target allowances. User HTTP settings remain usable. Unrelated .claude/ is preserved. No push/merge.
