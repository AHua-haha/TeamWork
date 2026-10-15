# Agent harness

## Purpose and boundary

A harness collects reusable tools, operating scope and rules for one purpose. It owns that purpose's file/command authority, supplied context, context maintenance prompts, edit history and commit policy. An agent can have several harnesses and work on several independently versioned parts. The runtime runs the model/tool loop using the assembled harness environment.

The lead manages members and assigns working/dependency designs through the existing assignment fields. This increment implements the harness system; a new harness configuration interface and approval UI are deferred. Backend review and user acceptance operations are available.

## Inputs and preconditions

- Git must be installed and executable. One backend process owns the database and harness operations.
- Each team member, including the lead, receives a separate managed Git worktree seeded from the original workspace's nonignored regular files and context files. Existing managed worktrees are reopened rather than reset. Source symbolic links are omitted; file tools cannot follow links.
- Existing assignment input remains `{designScope: {working: [paths], dependencies: [paths]}, allowedCommands: [rules]}`. Each design list has at most 50 distinct valid user-context design records, with no overlap. Command rules are exact argv vectors or exact executable names/paths, at most 50, with no implicit shell parsing.
- A design record is JSON `{content: "Markdown", implementation: [paths]}`. Up to 50 distinct implementation paths may name future files/directories, or `.`; mappings exclude `.git` and `.context`.
- A member's working design files and corresponding implementation are editable through common read/write/edit tools in its worktree. Dependency design and implementation are read-only. Dependency read-only authority wins on overlap. Scope changes still follow original-workspace assignment mappings, not unapproved edits in an agent's files.
- The lead's default design-maintenance harness can read the workspace/context and edit `.context/user`; workers can read selected designs and mapped implementation. Ordinary tools never edit `.git` or `.context/agent`.
- Default purpose bundles are design maintenance and implementation. Their writable parts have IDs `design` and `implementation`; the former requires user commits, the latter allows agent commits. Implementation excludes context and dependency paths. Empty implementation assignments do not grant implementation writes. The core accepts typed purpose/part definitions in process; no new configuration endpoint is provided.
- A part has an ID, managed paths, exclusions, commit policy (`user` or `agent`) and rule text. Independently managed parts in one worktree must have disjoint effective paths. Durable scope identity follows the path/exclusion set, not the member. Members retain separate pending histories and committed bases for that scope.

## Outputs and observable effects

### Tools, prompts and execution

The harness supplies reusable `ls`, `read`, `write`, `edit`, `commit_scope`, `scope_history`, `restore_scope`, and optionally `run_command`. Writable file tools are omitted without writable parts. Tool implementations are shared across agents; current harness rules determine authority. Existing lead team-management/assignment tools remain available.

All configured purpose and part rule prompts are assembled into the system prompt. Automated context maintenance is model-guided text only. Requests include bounded accepted working-design content, dependency designs and the member's implementation files (64 KiB per section, omitted paths named). Pending design edits can be inspected with file tools, but do not replace accepted design content in the supplied working-design section.

Commands run in the member's private worktree, match allowed vectors/executable names exactly, have no implicit shell parsing, retain up to 64 KiB combined output and time out after 60 seconds. Cancellation terminates the process/process group where supported. Allowed command effects remain outside file-tool confinement in this prototype.

### Independent checkpoints and commits

- Every finished run invokes automatic checkpointing of its managed parts, after outstanding policy/tool effects settle. Completed, failed and cancelled runs checkpoint; interrupted-run recovery invokes checkpointing before persisting interruption. A successful final group response checkpoints before publication so recipients cannot observe completion first.
- Checkpoints record state, not semantic success or acceptance. An unchanged tree reuses its checkpoint; a run-specific reference still records that run's snapshot. A refused publication can continue the run; later edits are captured on the next publication attempt or finalization.
- `commit_scope({part, message})` captures an exact scoped revision and records an intentional semantic commit with actor/run, message and time. Implementation commits need no user approval. Agent attempts to commit design return `approval_required` without changing its committed revision. There is no agent checkpoint tool.
- A semantic commit advances that scope's committed reference and the committing work area's base, while checkpoint history remains available. A checkpoint never advances the committed reference.
- `scope_history({part})` returns up to 100 immutable checkpoint/commit records. `restore_scope({part, revision})` restores a reachable part revision, preserves previous pending edits as history, and records a new restore checkpoint. It does not change another part's files, selected checkpoint or committed revision. Restoring the latest committed snapshot explicitly refreshes a stale work area's base.
- Another member using the same effective scope seeds from its latest committed snapshot when first assigned. An already-open work area is not automatically overwritten. Commits from an outdated base are refused; the agent/user must inspect history and explicitly refresh or resolve the work. Automatic merge/integration into existing worktrees or the original workspace is deferred.
- The original workspace Git branch and index are never used for harness snapshots or commits. The original context API continues to describe original-workspace files. Harness Git is authoritative for member edit/checkpoint/commit history. Committing a design in harness history does not automatically publish it into the original context catalog or change assignment mappings.

### Backend review and acceptance

Under `/workspaces/:workspaceId/team/members/:memberId/harness`:

| Operation | Request | Result |
| --- | --- | --- |
| Review | `GET` | `{memberId, directory, parts}`; each part has its definition, checkpoint/committed/base revisions, exact review revision and diff |
| History | `GET /:part/history` | `{history}` with immutable revisions, kind, actor, message, time and tree |
| User commit/acceptance | `POST /:part/commit`, `{revision, base, message}` | Semantic commit of the exact reviewed revision against the expected committed base |
| User restore | `POST /:part/restore`, `{revision}` | New restore checkpoint for that part |

Review creates a stable snapshot if current edits are not yet checkpointed. User commit and restore require an idle member. The caller must name the member inside the specified workspace. Actor identity is supplied by the backend; request fields cannot impersonate an agent or supply approval through agent tool arguments. The server retains the existing loopback/no-authentication deployment model.

Design acceptance validates JSON design records before committing. The user must review again if files, the selected checkpoint or the committed base have changed. Acceptance records `actor.type = user` and applies only to that part. Git checkpoint objects, conversation text and implementation commits do not constitute design approval.

## Failure behavior

Out-of-scope file operations, dependency writes and disallowed commands are refused with reasons. Expected tool refusals remain private tool results so an agent can recover. Invalid definitions/overlap, malformed design records and input errors fail explicitly. Foreign/unreachable restore revisions are refused. Stale reviews/bases fail with `stale_revision` and change no committed references. A commit without permission fails with `approval_required` or `access_denied`. Missing members/parts fail with 404; busy user acceptance/restore fails with 409.

Git/storage failure is observable and never represented as a successful commit. Reference updates for committed state/base are transactional. Restore validates paths/links first and attempts to restore the previous file snapshot on failure; if rollback also fails the operation fails and retained history remains available. Filesystem restoration and Git storage are not one cross-filesystem transaction. A checkpoint failure prevents successful final group publication and becomes run failure; a recovery checkpoint failure prevents startup from announcing recovery complete.

Snapshots refuse symbolic links in managed state and cap capture at 20,000 regular files, 64 MiB per file and 256 MiB total. Tool text/path limits remain in force. Git processes time out after 60 seconds and have bounded output. Failure after a file edit can leave pending files, which remain available in the retained worktree for inspection/retry.

## Guarantees and limits

Different agents have separate working files. Parts have independent history/reference state; restoring one part never performs a whole-worktree reset. Scope history and committed snapshots survive agent replacement and backend restart. Retired member worktrees/history are retained; ending runs still checkpoint their effects. Worktree garbage collection is deferred.

The backend manages checkpoints, commit permission and approval records. It does not sandbox permitted commands, automatically merge accepted changes into project branches, add configuration/approval UI, or implement automatic compaction/knowledge consolidation. Original workspace edits are not live-synchronized into existing member worktrees. Assignment mappings continue to come from the original design catalog until explicit integration/configuration changes them.

## Acceptance examples

1. Backend edits design and implementation in its worktree. The original workspace and Frontend's files remain unchanged.
2. Backend commits implementation with an intent. Its pending design remains uncommitted; the run-end checkpoint supplies no approval.
3. A user reviews design revision D3 and accepts it against base D1. If new edits arrive before acceptance, refuse rather than commit unreviewed content.
4. A workspace contains design D3, implementation I7 and usage U2. Restoring earlier design content records a new design checkpoint while I7/U2 and the accepted design revision stay unchanged.
5. Another work area commits the same scope first. Refuse a stale commit; explicitly restoring the latest committed revision refreshes the local base without erasing its prior checkpoints.
6. A tool finishes cancellation cleanup before checkpointing. Its partial file effects are preserved, and the run is cancelled without a fabricated final group response.
