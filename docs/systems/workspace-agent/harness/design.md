# Harness

## Purpose and boundary
A harness supplies reusable tools, file scope, commit permission, and operating/maintenance rules for one purpose. The runtime assembles those capabilities and executes the model loop. Members have separate working trees and independent scoped histories. The two prototype bases are project and command. The project harness owns design management and implementation together, including tools, scopes, maintenance rules and commit policies. The command harness owns the allowed-command capability. Bases are fixed backend policy; agents configure assignments only. Richer command-boundary rules and agent-facing command configuration are deferred; existing exact/executable command matching retains its current behavior.

## Inputs and preconditions
Member assignments contain designScope {working, dependencies}, implementationScope {paths, usePaths}, and existing allowedCommands. Each scope list has at most 50 distinct safe relative paths. Designs must be user design references; working and dependency lists are disjoint. Implementation paths exclude .git, .context and .team control files; dot means the project root with those exclusions. Read-only use paths override writable paths on overlap. A design's implementation mappings describe the project but never grant access.

The fixed project base grants common list/read/write/edit and scope history/restore/commit tools. Working designs can be edited as pending files; dependencies can only be read. Design semantic commits require explicit user acceptance. The lead base includes bootstrap user-design management and a separate member-config draft part; ordinary implementation scopes cannot own these files. That same project base grants operations on explicit implementation paths; use paths are read-only. Implementation semantic commits permit the agent. Mandatory base prompts describe operation, maintenance, checkpoints and approval. Submitted Markdown prompts supplement member instructions without changing enforced authority.

The lead has fixed workspace-wide delegation authority for safe design and implementation assignments, and common file access to .team/members bundles. Workers cannot configure members. An editable version 2 member manifest groups designScope and implementationScope under harnesses.project. It cannot grant management authority, replace tools/prompts/policies, or change command permissions. Existing allowedCommands feed the separate command harness. Commands continue to match exact argv or executable names and run in the member worktree, without filesystem confinement.

## Outputs and observable effects
File operations use current accepted assignments; edits to draft member configuration do not change them. Design mappings changing do not change permissions. The project harness contains independent design and implementation parts with separate checkpoint/committed references. Grouping them into one harness does not combine their commit policy or Git state. The command harness owns no file-history parts. Member-config draft checkpoints and commits never activate configuration: explicit validated submission is required.

The harness checkpoints finished runs (completed, failed, cancelled, interrupted) after outstanding effects settle, and before successful group publication. Checkpoints preserve recoverable edits without semantic acceptance. commit_scope creates an intentional commit of one authorized part; scope_history lists revisions and restore_scope restores only that part. User design acceptance names exact reviewed revision/base and requires an idle member. Accepted snapshots are retained in private harness Git, without automatically merging original workspace or peer files.

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
Unsafe paths, unauthorized edits/commands, unknown parts, invalid design acceptance, stale reviewed bytes/base or unapproved design commits fail explicitly. Dependencies stay read-only. Failed snapshots do not advance accepted state; checkpoint failure prevents successful final publication. Scope restoration preserves other parts and refuses foreign revisions and symbolic links. Abrupt interruption during disk restoration can leave pending partial edits; recorded revisions remain available.

## Guarantees and limits
Tool implementations are role-independent. Fixed bases determine tool selection, commit policy and mandatory rules; assignment files only narrow the available workspace domain. Each agent has an isolated worktree and scope indexes share Git objects. Checkpointing and committing one part do not accept another. Accepted design publishing to original catalog and automatic peer synchronization are deferred. File tools enforce scope; permitted command effects remain outside that enforcement. Prompt compliance is instruction-driven, with access/approval enforced by code.

## Acceptance examples
1. A member edits its working design and src assigned explicitly; design commit is refused without user acceptance while implementation commit succeeds.
2. A dependency design maps shared/, but shared/ is readable only if listed in implementation usePaths or paths. Editing a design mapping grants no new path.
3. Writable src with usePaths src/shared allows read but refuses writes under src/shared.
4. The lead edits a member bundle, checkpoints it, and the active member remains unchanged until submit succeeds.
5. Configuration asks to change fixed commit policy or tools: refuse submission and retain active state.
