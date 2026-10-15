# Harness and runtime responsibilities

Status: complete
Task start commit: da12262c8a641fec9e37c6cf2a5bea9b378d1b27
Review boundaries: [Harness](drafts/workspace-agent/harness/design.md), [agent runtime](drafts/agent-runtime/design.md)

## Design outcomes

- [delivered] Organize harnesses by purpose, with each harness owning the full scope, capabilities, context and context maintenance rules for that purpose.
- [delivered] Assemble a member's runtime from the harnesses configured by the lead; keep purpose-specific authority and rules in harnesses.
- [delivered] Give different agents separate Git worktrees; independently checkpoint, restore and accept parts within each agent's worktree through scoped Git references.
- [delivered] Use reusable file tools for design editing, with harness-owned per-part approval policies and acceptance records.
- [delivered] Automatically checkpoint each finished agent run, and provide a separate permission-controlled agent commit tool. Design commits require user acceptance.
- The initial discussion-only record is superseded by the authorized implementation increment below. The candidate now includes code, tests and matching canonical contracts.

## Decisions and open questions

- The former split between scope/boundary and context maintenance is replaced by purpose-based harnesses. Both responsibilities belong inside each harness.
- The lead manages members, assigns work, and configures their harnesses. A member can have multiple harnesses, such as design maintenance and implementation based on design.
- Together the configured harnesses define what the agent can do. Runtime development concerns how the agent runs with those harnesses and mechanisms that support them.
- Tools implement reusable capabilities independently of agent identity or role. Harnesses collect tools and configure access and operating rules. Design reading/editing uses common file tools.
- Retain existing file-scope permissions and command allowances. For the prototype, maintenance rules are text prompts; the runtime assembles the harness prompts into its system prompt.
- Design is the shared user–agent contract. Agents edit pending design files; only the user accepts them as authoritative. This supersedes the earlier direct-save model for the proposed design. Approval concerns accepting design content, not automatically creating a project Git commit or merging into main.
- Settled workspace model: separate worktrees for different agents; within one worktree, multiple managed parts have independent scoped Git references and checkpoints. Switching one part leaves the other parts' selected revisions and working files unchanged.
- Each part records whether user approval is required, its current checkpoint and accepted revision, and acceptance attribution. An automatic checkpoint does not itself constitute user acceptance. Checkpoint/semantic-commit records and exact-revision acceptance are defined in the implemented harness contract.
- Settled checkpoint/commit distinction: the harness automatically records per-part checkpoints when an agent run finishes. Checkpoints capture state and carry no semantic completion or acceptance claim. Agents receive a commit tool, not a checkpoint tool; committing is an intentional semantic operation allowed only by the part's harness permissions. For design, only user acceptance authorizes committing the selected design changes. Finishing a run or making an internal Git commit object never supplies that approval.
- Settled editing/commit policy: an agent may edit both design and implementation within its configured harness scope. Design commits require user approval; implementation commits may be performed by the agent without user approval when its harness grants commit permission. The same reusable tools serve both; editing authority and committing authority are separate harness rules. This replaces the current prototype's lead-only direct design-save restriction in the proposed model, without granting every agent unrestricted design editing.
- Git indexes contain only the associated scope's paths and share the harness Git object database. Indexes stage snapshots; references select checkpoints; the harness materializes only the selected part's files. Updating an index or reference alone does not change working files.
- Durable scope/design identity survives member replacement. Current worktree/checkpoint selection is associated with the editing work area; it must not turn durable project knowledge into per-member storage.
- Agent-owned harness context and durable project knowledge remain organized around the user's design and subdesigns, independent of temporary member identity.
- Deferred: a new harness configuration interface, approval UI, automatic integration into original/peer worktrees, worktree garbage collection and advanced context-maintenance mechanisms. The implemented contract defines tool composition, commit/review records, stale-base refusal, unchanged checkpoints and run finalization/recovery ordering.
- Parts independently restored within one worktree need disjoint managed file paths. Cross-agent assignments may use separate copies; their later integration/conflict policy is still open.
- The existing prototype's command confinement policy remains undecided. This guidance does not resolve it or implement context maintenance.

## Checkpoints and remaining work

- Persist the agreed concepts and responsibility boundary as proposed system designs and implementation guidance.
- Implemented the settled worktree, scoped-reference and per-part approval model; candidate canonical contracts have been reconciled with code.
- Record the user's final choice of automatic run-end checkpoints plus permission-controlled semantic commits. The earlier suggestion of an agent checkpoint tool is superseded.
- Verified shared tools, real Git worktrees, independent history/restore, exact user acceptance, agent semantic commits, original Git preservation, cancellation effect ordering, failed/cancelled runs and interrupted-run recovery. Final checks passed: TypeScript check/build, 71 backend tests, 38 disposable MySQL integration tests and documentation parity/link/whitespace checks. This coherent implementation checkpoint completes the authorized harness-system scope; no push/merge is authorized.
- Documentation verification: [tests.jsonl](tests.jsonl).

## Authorized implementation increment

The user authorized the harness system and deferred the configuration interface. Existing assignment inputs remain available; runtime assembly derives purpose-based design and implementation harnesses from them. The core also accepts typed harness definitions in process, without adding configuration UI or configuration endpoints.

Implementation decisions for this prototype:

- One backend-managed bare repository per workspace, outside its directory, provides isolated detached member worktrees and shared scoped-history objects; it does not mutate the user's repository/index/HEAD. Seed from current nonignored workspace files and design context. Worktrees are retained through retirement/restart.
- Each part has disjoint managed paths, exclusions, rule text and an agent/user commit policy. Existing assignments produce a design part and an implementation part; dependency material is read-only and excludes implementation writes.
- Semantic commits select exact immutable snapshots, record reason and actor, and compare the expected committed base. User-only design commit is exposed through backend review/acceptance operations; agents receive commit_scope and never an approval credential.
- Scope history and restoration are core operations. Changes are serialized within one member environment. Restore retains old history and changes no unrelated part. A no-op automatic checkpoint reuses the latest snapshot; run completion still invokes checkpointing. Completed, failed and cancelled runs checkpoint after outstanding tool effects stop; interrupted-run recovery checkpoints before marking the run recovered. Checkpoint failure is observable and prevents successful final publication.
- A member's successful final publication checkpoints before durable publication completes; finalization also checkpoints failure/cancellation and any additional edits after publication refusals. Run-id attribution and identical-tree reuse avoid duplicate unchanged checkpoints.
- Accepted snapshots are stored in harness Git; automatic integration into the original workspace or other existing member worktrees is deferred. New work areas seed assigned parts from their latest committed snapshots; stale bases are refused rather than silently merged. Accepting a design does not merge project branches.
- Context base continues to version the original workspace files. Harness Git is authoritative for member edit/checkpoint/semantic-commit history; these are separate surfaces, not duplicate histories for the same editable state.

## Handoff

Implemented system contracts are [harness](../../systems/workspace-agent/harness/design.md) and [runtime](../../systems/agent-runtime/design.md). The new harness configuration interface was explicitly excluded. Original-workspace/peer-worktree automatic integration and approval UI remain future work, as recorded in the contract. Existing assignment inputs and original context/catalog APIs remain available. Tests and unsuccessful intermediate runs are preserved in tests.jsonl; the final successful runs verify the exact candidate.
