# Three harnesses and scoped Git through Bash

Status: complete
Task start commit: b489d67e6b8296f41c9654ff29bcbcab8489e2d6
Implementation increment start: d08936cc05b08382b90069887f02937d801b1899
Review boundaries: [Harness](drafts/workspace-agent/harness/design.md), [Member configuration](drafts/workspace-agent/team/design.md), [Lead workflow](drafts/workspace-agent/team/lead/design.md)

## Design outcomes

- [delivered] Persisted the design discussion in two documentation checkpoints, then implemented the authorized harness increment.
- [delivered] Management, implementation and execute bases replace project/command; common tools and maintenance prompts are assembled once.
- [delivered] Backend-owned member metadata; editable JSON/Markdown contains meaningful configuration and designScope, without agent-maintained version/revision or independently configurable implementationScope.
- [delivered] Lead-only member files and user-approved design/member semantic commits; file acceptance remains separate from stable active settings.
- [delivered] Unified bash with metadata.git.scope and ordinary Git replaces run_command, commit_scope, scope_history and restore_scope agent tools.
- [delivered] Independent scope staging/HEAD with shared objects and separate automatic checkpoint indexes; exact user acceptance, stale-base protection, history and restore are retained.
- [delivered] Accepted working/dependency mappings determine implementation authority, with read-only precedence and protected control files. Accepted design snapshots feed semantic reads/discovery without copying original/peer files.
- [delivered] Stable read-only member inspection and frontend labels reflect three bases and backend-derived paths; group chat/streaming remains unchanged.

Canonical contracts: [harness](../../systems/workspace-agent/harness/design.md), [team](../../systems/workspace-agent/team/design.md), [lead](../../systems/workspace-agent/team/lead/design.md). Accepted drafts and the corresponding canonical files agree.

## Decisions and deferred work

The user selected lead bootstrap .context/user and .team/members management access, with no implementation access before an accepted design assignment. Design/member semantic commits require exact user approval. Implementation commits may be made by the agent. Pending mappings grant no access.

Member configuration change/activation handling remains explicitly deferred: detection, validation-to-activation, creation/update/retirement through files, protected self changes and application to running members. No accepted-file watcher or activation handler is added. The old submit_member_config and retire_member agent shortcuts are removed; trusted backend lifecycle primitives and existing admission/revision checks remain. A user-approved member-file commit does not change stable active settings.

Concrete implementation choices:

- Bash input is {command, metadata?: {git: {scope}}}; one scope per invocation. Scope selection cannot supply identity, approval, indexes, refs or arbitrary repositories.
- Native Git operations are mediated by an invocation-bound backend Unix-socket bridge with an explicit finite syntax. OS isolation protects repositories and file scopes from shell/descendant bypasses. @anthropic-ai/sandbox-runtime 0.0.79 supplies sandbox-exec on macOS or bubblewrap on Linux; no unrestricted fallback or network allowance is provided. This increment was verified on macOS; Linux requires its sandbox dependencies.
- General Bash allowances match [bash,-c,command] exactly or executable bash. Old non-Bash rules are preserved as data but do not authorize a shell. Richer execution configuration remains deferred.
- Protected member/design commits use the existing exact-revision/base review endpoints; no new approval/configuration UI is introduced.
- Per-design accepted Git pointers take precedence in semantic design reads/discovery and scope resolution. Raw context file/history APIs still show the original workspace. No peer-worktree refresh or automatic original-checkout merge is added.
- Active legacy records lose explicit implementation assignments and migrate accepted sources once to backend formatVersion 3. Exact previous source, prompt bytes, identities/settings/commands, pending drafts and old Git references remain retained. Existing drafts are never automatically rewritten. Matching scopes retain history; changed scope shapes preserve pending work under a new reference while historical refs remain reachable.

## Checkpoints and verification

- 8787c7931f04acaa7f797691e6ea88424962fa7a saved the initial proposal/checklist only.
- d08936cc05b08382b90069887f02937d801b1899 recorded the selected bootstrap scope and deferred activation handling, still documentation-only.
- The implementation checkpoint promotes fifteen reconciled documents with code/tests and this task record. It is identified in Git by Task-ID: 2026-10-16-harness-bash-scopes.

Final candidate verification passed:

- 89 backend unit/HTTP tests, including real Bash isolation, native scoped Git, staging/checkpoint separation, protected approval, descendant/native-Git/hard-link attempts, dependency boundaries, accepted mappings, stale-base restore and cancellation/output bounds.
- 42 disposable MySQL integration tests, including real runtime tools, stable source/history, group publication/checkpoint ordering, failures, cancellation and restart.
- 56 frontend tests, including Bash command summaries; frontend production build.
- Backend production TypeScript build.
- Documentation verification: 45 Markdown files, fifteen draft/canonical pairs, required sections, local links, JSON examples, obsolete tool registration removal and whitespace.

Every run, including failed development checks, is appended in [tests.jsonl](tests.jsonl) with its increment's starting SHA. No paid provider calls or user database changes were made. The unrelated untracked .claude/ directory is preserved. Review remains on codex/lead-harness in the project base folder; no push or merge is performed.
