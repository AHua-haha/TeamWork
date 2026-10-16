# Three harnesses and scoped Git through Bash

Status: proposed
Task start commit: b489d67e6b8296f41c9654ff29bcbcab8489e2d6
Review boundaries: [Harness](drafts/workspace-agent/harness/design.md), [Member configuration](drafts/workspace-agent/team/design.md), [Lead workflow](drafts/workspace-agent/team/lead/design.md)

## Design outcomes

- [delivered] Persist the design discussion and the implementation changes it requires. This checkpoint changes documentation only.
- [planned] Replace the current project/command bases with management, implementation and execute harnesses.
- [planned] Make version/revision and other control metadata backend-owned; the agent edits meaningful member configuration files.
- [planned] Treat member configuration as a harness-controlled pending file scope, accessible among agents only to the lead, with user-approved semantic commits.
- [planned] Replace run_command and the three dedicated scoped-history tools with one reusable Bash capability. Ordinary Git commands request a scope through Bash metadata; the harness resolves context and enforces its rules.
- [planned] Configure only working/dependency designs in the member's harness assignment; derive implementation authority from accepted design mappings.

## Decisions and open questions

### Settled direction

1. Tools are reusable capabilities for all agents. Harnesses own scope, authority and maintenance rules; runtime assembles the available tools and prompts and runs the agent.
2. The management harness owns design and member maintenance. It supplies scoped file access and controlled Git capability through Bash, plus maintenance and Git-use instructions. Design and member configuration have independent histories; committing either requires user approval. Workers never gain member-path access from a role label or Bash metadata.
3. The implementation harness owns implementation read/edit authority. It retains agent-authorized implementation commits and read-only dependency precedence.
4. The execute harness controls general command execution. It cannot override protected management paths or Git acceptance policy. Management may supply its limited scoped Git capability without enabling general commands.
5. Agent-facing Git operations use ordinary Git syntax through Bash. Agent-supplied metadata selects a requested scope; backend supplies identity, indexes, refs, accepted bases, revisions and approval. Metadata is not a grant of authority. Actual Git operations must be checked under that context.
6. Remove the agent-facing commit_scope, scope_history, restore_scope and run_command paths when their replacement is implemented. Preserve the required history, restoration, cancellation and failure guarantees.
7. Each member keeps its separate worktree. Scope staging/history remains independent. Automatic run-end checkpoints continue without accepting changes or consuming/resetting agent staging.
8. Member JSON and referenced Markdown remain the editable configuration source. Backend retains exact accepted bytes and metadata separately from pending edits. Agents do not maintain format version or optimistic configuration revision in those files. Identity/model/responsibility/prompt content remains meaningful member configuration; only the harness assignment is reduced to design scope.
9. Working-design mappings yield writable implementation paths; dependency-design mappings yield read-only implementation paths. Read-only paths win overlaps; control paths remain protected. Pending design edits grant no authority. Invalid or unresolved references do not activate configuration.
10. Base tools, maintenance rules and commit policy remain fixed. Configurable execution rules beyond the agreed direction remain for later discussion. No new frontend configuration or approval UI is settled here.

### Still open before implementation

- Validation, user acceptance and activation ordering for member bundles: whether submit_member_config remains a validation/review operation or is replaced, when acceptance activates settings, and which failures preserve the previous accepted state. A Git checkpoint/commit alone must not be assumed to activate a member until this is designed.
- Backend association of an editable bundle with member identity and its editing base, including creation, stale drafts, protected lead/self changes, busy targets and retirement. The agent should not reproduce version/revision bookkeeping.
- Which accepted design store/snapshot supplies mappings, how accepted harness design commits become visible to that resolver, and when changed mappings apply to already-running members or existing worktrees. The current implementation defers catalog/peer integration; deriving from accepted mappings must resolve that gap explicitly.
- Exact new member manifest and Bash metadata schemas, scope selection defaults, and which Git commands/options are supported. Examples in the drafts illustrate the direction, not a frozen schema.
- How Bash and descendant Git operations are mediated and how management writes and accepted Git state remain protected. A metadata label, shell alias, PATH wrapper or command-string check alone does not establish that boundary. The concrete enforcement mechanism is not selected.
- Initialization/bootstrap and migration: the lead must be able to help create the first design; existing explicit implementation assignments, indexes, refs, approvals, accepted source bundles and drafts require deliberate conversion without silently widening authority or losing pending work.

## Checkpoints and remaining work

The baseline has fixed project/command bases, explicit implementationScope assignments, immediate file submission activation, agent-maintained manifest version/revision, agent-authorized member-config commits and argv-only run_command. This proposal supersedes those choices for the next implementation; current canonical documents remain accurate for the baseline.

| Area | Required adjustment |
| --- | --- |
| Harness bases and inspection | Assemble three bases and expose their effective scope, tools, prompts and commit policy |
| Member files and metadata | Lead-only member scope; user-approved commits; backend-owned identity/base/schema bookkeeping |
| Design resolution | Derive implementation paths from accepted working/dependency mappings; preserve read-only precedence and safe-path validation |
| Bash and Git execution | One Bash tool with optional scoped Git metadata; trusted context resolution and operation checks; controlled general execution |
| Scoped history | Persistent independent staging/reference context for ordinary Git; separate automatic checkpoint indexes; preserve exact-byte approval and restore behavior |
| Member lifecycle | Capture/validate reviewed source bundles and activate only through the agreed approval flow; preserve previous configuration on rejection |
| Runtime and prompts | Assemble harness-provided tools/instructions; remove obsolete tool guidance and agent version/revision requirements |
| Storage, routes and frontend callers | Reconcile stable metadata, review/acceptance and effective-scope inspection after schemas/activation are settled; preserve read-only member inspection and existing group-chat behavior |
| Migration and tests | Convert existing accepted/pending state deliberately and replace tests asserting the superseded contract |

Drafts retain the unchanged cooperation and final-response behavior. Implementation is not requested by this persistence step, and no canonical system document or application source is changed. No application test result is claimed. Documentation checks and their starting commit are recorded in [tests.jsonl](tests.jsonl). The unrelated untracked .claude/ directory is preserved.

The documentation-only checkpoint saves six draft contracts/plans and this change checklist. Verification passed for all seven Markdown documents: required sections, proposal markers, local links and whitespace. Canonical/application files match the task's starting commit. Implementation remains pending the open decisions above.
