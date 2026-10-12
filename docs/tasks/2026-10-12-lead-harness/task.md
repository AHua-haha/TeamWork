# 2026-10-12-lead-harness

Status: complete
Task start commit: 60a9625472188e5d5947254886a0cf1f81a3439a
Review boundaries: [Lead](drafts/workspace-agent/team/lead/design.md), [Team](drafts/workspace-agent/team/design.md), [Harness](drafts/workspace-agent/harness/design.md), [Context base](drafts/workspace-agent/context-base/design.md)

## Design outcomes

- [delivered] The lead helps the user create, update, and clarify the project design and subdesigns, with every design change visible to the user.
- [delivered] The lead decomposes work from the design, creates and configures members, and assigns work with references to the relevant design.
- [delivered] A harness supplies each member's allowed file tools, design references, and file context to the runtime, enforcing its scope and boundary.
- [delivered] Harness configuration contains working and dependency design references and allowed whole commands or executables. Design parts maintain the corresponding implementation references.
- [deferred] Automated maintenance and consolidation of harness context, scope enforcement for permitted commands, and richer cooperation scheduling.

## Decisions and open questions

- The user's design is the shared contract; durable knowledge follows the design and subdesigns independently of member identity. Members may be temporary or reused.
- The harness has scope and authority plus context-maintenance responsibilities. This increment implements scope and authority and context delivery; maintenance follows later.
- The user chose applying design changes discussed in the conversation and showing them, without a separate acceptance screen.
- The user stopped implementation to settle the harness configuration design first. Earlier uncommitted implementation work is preserved in the isolated worktree.
- The harness has two configuration parts:
  - design scope: working design is read and followed, its implementation is readable and editable; dependency design and implementation are read-only;
  - allowed commands: exact whole commands or allowed executables with arguments.
- Each design part maintains its corresponding implementation directories or files; harness permissions follow that mapping.
- The user explicitly deferred how permitted command execution interacts with file scopes to future development. No trusted-execution or strict-isolation choice is implied.
- The user resumed implementation of the settled design. Representation choices: a design file holds JSON with Markdown content and implementation paths; a member holds one harness with designScope (working/dependencies) and allowedCommands (exact argument vectors or executable names). These replace the old agent-context scope field.
- New and migrated workers have an empty harness until the lead configures design references. Prior conversations and model settings are preserved; old scopes are not silently treated as design scopes.
- Commands execute as an executable plus argument vector from the workspace directory, without implicit shell interpretation. Only allowance matching is guaranteed in this prototype; filesystem confinement of permitted commands remains deferred.
- Implementation work uses an isolated worktree because the primary checkout holds the preceding design discussion's uncommitted drafts.

## Checkpoints and remaining work

- One completed checkpoint delivers the lead, structured design parts, design-based harness, command allowances and frontend presentation. Canonical contracts: [lead](../../systems/workspace-agent/team/lead/design.md), [harness](../../systems/workspace-agent/harness/design.md), [design parts](../../systems/workspace-agent/context-base/design-parts/design.md), and [team](../../systems/workspace-agent/team/design.md).
- The earlier uncommitted text-only design and old-scope assignment approach was superseded by the settled structured design/harness contract. Recorded test runs, including failures, remain in [tests.jsonl](tests.jsonl).
- Completed drafts were promoted with matching code and tests. Final candidate verification: backend build/type check; 63 backend unit tests; 30 real MySQL integration tests including lead save, member creation, harness configuration, assignment, mapped write, permitted command and report; frontend production build/type check and 36 tests; canonical document links, required sections, draft parity and whitespace checks. All passed. An earlier watcher test missed an event; its isolated rerun and final full suite passed. Provider streams in the automated workflow are deterministic; live model decision quality has not been evaluated.
- Automatic harness-context maintenance, parallel cooperation and the future permitted-command filesystem policy remain deferred by agreement. No remaining work for this prototype checkpoint. Task-ID commits identify the resulting SHA; every test starts from the recorded baseline.
- Development checkout: /Users/ahua/.codex/worktrees/lead-harness/rsi-agent, branch codex/lead-harness.
