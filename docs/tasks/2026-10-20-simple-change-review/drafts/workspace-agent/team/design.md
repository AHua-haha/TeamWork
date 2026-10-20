<!-- Task proposal; current contract is under docs/systems/ -->
# Team

## Purpose and boundary

The team belongs to one workspace and has two responsibilities: manage member creation, configuration and retirement; and coordinate work among members. The user and all active members participate in one shared workspace chat. The lead helps maintain the user design, divides work based on that design, configures harnesses and assigns members through shared responses. Members may be created or retired as the work changes. Designs and implementation survive member changes.

Members exist only inside their team and are absent from the global agent list and agent config API. Each retains its own private execution history alongside individually delivered shared messages. Model loops belong to the runtime, file authority and context delivery to the harness, and durable design records to the context base.

## Inputs and preconditions

### Member identity, files and effective harnesses

Each workspace has one unretirable lead and uniquely named active workers. The lead edits member JSON and referenced supplementary Markdown files through its management harness. Backend owns identities, source associations, revisions and format bookkeeping; these are not agent-maintained manifest fields. Fixed base prompts/policies are backend-owned.

Three semantic operations are derived from the proposed member files:

| Operation | Validation and result |
| --- | --- |
| Create | A new member receives valid design assignments, model settings from workspace choices/defaults, responsibility, prompts and execution configuration. Backend assigns a new identity. |
| Update | Only execution rules, supplementary prompts and responsibility may change. Name, role, model/run settings, identity and working/dependency design assignments remain fixed. |
| Delete | Retire the member, preserving its conversation/history, files and Git history. The lead cannot be deleted. |

Changing a working/dependency assignment is not an update; an explicit replacement can be proposed with create/delete and remains subject to user review. Implementation access is always derived from accepted assigned designs; it cannot be independently configured. A separately user-approved design-mapping change remains a design change, not a member reassignment.

Working mappings grant writable implementation and paired working-design implementation context; dependency designs grant read-only implementation/context, with read-only precedence and protected control paths for write/edit inputs and controlled Git scopes. Broad Bash authority is separate. Base tools and enforced policy cannot be changed through member prompt or execution configuration. The lead keeps global design-context management at .rsi/context/design and member management at .rsi/members; unassigned implementation-code access remains empty. Context paths are derived per design independently of the member identity.

### Member change workflow

The workflow is edit -> validate -> user commit -> separate user activation. Pending files, user-committed files and active configuration are distinct states. Validation reports create/update/delete changes and issues; it neither accepts files nor activates settings. Invalid files preserve previous stable active configuration and pending work. Intentional deletions remain pending rather than being recreated by discovery/materialization; a missing referenced prompt is an error, not a member deletion.

Only the user commits member configuration. The user reviews and commits exact file content under the existing member-config scope policy. Commit does not create, update or retire active members. Later, only the user can activate the reviewed committed change set. Uncommitted edits are excluded from activation and remain pending.

Activation requires the entire workspace team to be idle, including admitted runs and outstanding model/tool/finalization work. It applies the complete reviewed change set atomically. It neither stops running work nor queues an automatic retry. New work admission cannot race through the idle check. Activation does not trigger any member.

Activation revalidates the exact committed snapshot against current active configuration and relevant design/model state. Invalid, stale or busy activation changes nothing: no partial roster/source/settings updates, no member runs, and previous active state remains available. A changed accepted/configuration base requires fresh review. After activation, later group input uses the resulting team; new members receive shared history, updates retain private history and deleted members remain historical.

The editable JSON fields are name, role, responsibility, settings, promptFiles, designScope and execute: {allowedCommands}. Prompt references are ordered safe bundle-relative prompts/*.md paths (at most 20); relevant files must be UTF-8 text within existing text limits. Unknown fields/base overrides are invalid. Backend envelope formatVersion 4 and acceptedRevision belong to metadata outside those files. Startup converts active older source envelopes once, preserving previous exact source/settings/commands and existing drafts. Legacy drafts are not rewritten; reconcile their schema before validation. Retired bundle paths cannot be reused for a new identity; use a fresh bundle.

The lead calls validate_member_config({path: ".rsi/members"}) for the whole pending change set. It has no commit or activation authority. Member names must remain unique in the resulting team (at most 20); a create/delete replacement may reuse a retiring member name within the batch. No structured agent create/update/delete or activation tool bypasses the file/validation/user-acceptance flow. Member inspection remains read-only and distinguishes active source from pending or committed-but-inactive files.

### Work and cooperation

The user posts `{text}` to `POST /workspaces/:workspaceId/team/chat/messages`. Text is 1–20,000 characters. A user message without mentions triggers the lead. Explicit mentions select recipients using `@Name` or `@{Name With Spaces}`, matching active names ignoring case. An agent response routes only through an optional leading <mentions> JSON-array block. Missing/empty header triggers nobody, and @ text in its body is ordinary content. The shared response contains the body without the header. Duplicate mentions select one recipient. Selected user recipients retain their admission order but execute one at a time per workspace. Agent responses may mention at most one distinct member. Busy mentions are still refused, with no automatic retry.

Every accepted shared message is delivered to every active member, including the sender. Idle members append it to their continuing context immediately. Working members buffer incoming shared messages and append them in group order after their private work ends, without waiting for or triggering another activation. Each member context interleaves shared messages and its private work. Its previous private history remains available, but no other member receives it. Tool calls, results, intermediate responses and rejected publication candidates stay private. Only an accepted final response is published in the group transcript.

A final response is checked before the sending activation ends. If any recipient is unknown, retired, unready, self, or busy, the whole publication is refused: no shared message, recipient activation or budget consumption. The sender receives private feedback and can revise or retry within its current run. There is no queue, automatic wait or retry. A successfully published final response completes the sending activation before its recipients begin, so a recipient can mention the sender in its own response.

Each user-initiated exchange has a mention budget, initially 32 activations. Default lead routing counts one; each distinct recipient activation counts one. A response's activations belong to the same exchange. A message exceeding the remaining budget is refused in full. Already-started members can finish and publish without mentions. Cooperation ends when no members remain active. A new user message starts a new exchange and budget, subject to the same busy checks. `PUT /workspaces/:workspaceId/team/chat` with `{mentionLimit}` sets a 1–1,000 limit for later exchanges.

`GET /workspaces/:workspaceId/team/chat?after=0&limit=100` returns `{workspaceId, position, mentionLimit, messages, more, runs}` from persistent records. Messages contain author, text, recipients, stable ID, position, time and exchange ID; runs pair exchange IDs with runtime state. History pages contain 1–500 messages. `GET /workspaces/:workspaceId/team/chat/follow?after=0` synchronizes messages then follows shared messages and activation state across runs using version 1 `message`, `sync`, and `state` SSE events. A disconnected follower does not stop work. Group observation does not expose private execution traces.

`POST /workspaces/:workspaceId/team/chat/stop` stops existing exchanges and requests cancellation of active members. Later user messages may start new exchanges. Direct `POST /agents/:memberId/runs` refuses all team members; solo agents retain their own input API. Private member history/state/follow remains available for inspection. The [group chat contract](group-chat/design.md) provides the complete cooperation boundary.

Every model call receives current role, roster/readiness/running information, stable active member instructions and assembled harness context. Shared design knowledge remains independent of member identity. Harness tool details and execution limits are defined by the [harness contract](../harness/design.md).

## Outputs and observable effects

Pending member/design files are checkpointed without acceptance. User commit pins exact scope bytes and accepted base. User activation separately changes the stable active member source/projection in one atomic batch. Member identity, revisions, content attribution and exact prompt bytes remain backend-managed and durable.

Read-only team/member inspection continues returning active configuration, readiness/running state and the three effective harnesses with backend-derived implementation paths. GET /workspaces/:workspaceId/team returns active members; GET /workspaces/:workspaceId/team/members/:memberId returns {member, configuration, harnesses}. Configuration contains exact active JSON/Markdown source, path, digest, attribution/time and backend format metadata. Member POST/PUT/DELETE and member /config mutation routes remain absent. It does not activate drafts or create additional checkouts. User activation is a dedicated control operation; agent authority remains file editing and validation, not activation.

Group publication and selected run admission remain atomic and database-backed. Execution failure becomes status without fabricated shared output. Shared final messages and private histories remain independent of context compaction. File commit, member activation and shared final publication are separate effects.

## Failure behavior

Invalid schemas/paths/models/designs, forbidden updates, lead deletion, duplicate names, unsafe prompt references and base-policy overrides refuse the change set. Invalid references do not grant permissive scope. Metadata cannot claim lead/user authority.

Busy, stale or failed activation leaves the entire active team unchanged and retains committed/pending files. Group mention/readiness/budget/busy refusals remain atomic. Storage/checkpoint errors cannot be claimed as successful file acceptance, activation or publication.

## Guarantees and limits

One lead, unique active names, ordered shared messages, retained private histories, sequential workspace execution and accepted shared final responses remain guaranteed. Configuration activation is user-only, workspace-idle and atomic. Its separate user commit prerequisite cannot be inferred from a run completion or an agent statement.

Schema/version/identity bookkeeping stays outside editable manifests. Migration preserves identities/settings, exact prior source, pending drafts and historical Git references. An accepted file update cannot change assignment/name/role/manifest model settings; user-owned model preferences are configured separately. Execute source fields cannot override the fixed base policy. Scoped Git workflow checks remain separate from deliberately broader Bash/native Git authority.

No automatic configuration activation, automatic stop/retry, new trigger queue, multiple-chat model, durable run resume, automatic context-maintenance algorithm or workspace synchronization is introduced. Frontend activation presentation is separate from this backend contract. Accepted design-mapping refresh continues its existing authority semantics.

## Acceptance examples

1. The lead proposes a new Backend member in files. Validation reports create; user commit alone leaves the team unchanged. A later idle user activation creates it without starting a run.
2. A member prompt, responsibility and execution rules change. Validation accepts those update fields; activation preserves its identity, assignment, model and private history.
3. An update changes a working/dependency design, name, role or model settings. Validation refuses the entire change set. Explicit member replacement remains a separate create/delete proposal.
4. A committed change set creates A, updates B and deletes C. While any workspace member is running, activation is refused. When idle, all reviewed changes apply together or none do.
5. The lead manifest is removed. Validation refuses deletion of the lead. Removing a referenced prompt alone is a validation error.
6. Another accepted/configuration change makes review stale. Activation refuses instead of applying different bytes or overwriting newer settings.
7. Uncommitted edits exist after the user commit. Activating the reviewed committed snapshot excludes those edits; they remain pending.
8. A successful activation does not trigger work. Later shared messages use the resulting roster and normal mention rules.

## Unified streaming and model completion

Members finish using ordinary assistant text at natural model completion. Tool calls continue the run; metadata-marked commentary continues privately. Truncated responses fail without publication. Final selection prefers explicitly final text blocks and otherwise uses unphased text at natural completion. The team checkpoints and offers the selected text for atomic group acceptance; refusal appends private feedback and continues. Only accepted finals reach peer context.

## Backend API guidance for member display and configuration review

The member frontend consumes three API responsibilities: read active member information; inspect current member configuration and its status relative to the last activation; perform separate user commit and activation operations. The following endpoints provide this contract. Existing low-level pending/committed semantic review and generic harness file-review endpoints remain available.

### Read active member information

Expose the complete currently active member information: identity, role, responsibility, selected model and run settings, supplementary instructions/source files, harness rules and effective capabilities, readiness/issues and activity status. Active file configuration comes from the stable activated database snapshot, including exact source bytes and their validated projection. Effective model settings additionally reflect the latest user-owned preferences saved on that member. It does not require resolving a Git reference to load the configuration. Git/source references are traceability metadata; later file edits and commits do not modify this active snapshot. Backend-owned IDs, revisions and format metadata remain outside agent-editable member manifests.

### Inspect current configuration and status since activation

Current configuration means the latest editable member files in the lead's member-config scope, including uncommitted edits. It is distinct from the active database snapshot and may contain invalid or incomplete proposals. Inspection provides:

- The current member configuration and referenced supplementary prompt contents, with raw file content and validation issues when a parsed configuration is unavailable.
- The active baseline needed to show one comparison: active configuration to current configuration.
- Create/update/delete differences, including referenced prompt-content changes. A missing current member is represented as a proposed deletion; a new bundle is represented as a proposed creation.
- Member-config commit history since the last activation.
- Whether uncommitted edits exist relative to the latest member-config commit.
- Validation results and state/revision identifiers needed to review and operate on exact states safely.

Committed changes awaiting activation and additional pending edits may coexist. Consequently, status is not a mutually exclusive pending/committed label. Commit history describes accepted changes after the activation baseline, while the pending indicator describes additional uncommitted file changes. Pending edits may exist even when no new commit has been made since activation. Commit history and file status can remain meaningful even if current content happens to match active content.

The frontend displays the current configuration, its commit history/pending status and a single active-to-current diff. It does not need separate active-to-committed and committed-to-pending diffs. The backend supplies the comparison and status interpretation; the frontend does not infer these by reading runtime internals or traversing Git history itself.

### User operations

Commit accepts the exact reviewed pending member files into harness Git. It leaves active member configuration unchanged. Activation applies the exact reviewed committed member configuration atomically to the database only while the entire workspace team is idle, including admission and finalization. Uncommitted edits remain pending and are excluded from activation. The single active-to-current inspection diff must not imply that pending content is already committed or will be activated. Operation review identifiers distinguish the reviewed current files from the committed state eligible for activation without requiring a second displayed diff.

Existing lifecycle constraints continue: update changes only execution rules, supplementary prompts and responsibility; delete retires a worker and preserves history/files; the lead cannot be deleted. Validation, commit and activation do not trigger work. Changed reviewed state is refused and requires refreshed review; invalid configuration, stale reviews and busy activation preserve the previous active team.

### Inspection acceptance examples

1. Current files equal the activated configuration and no later commits exist: inspection reports no configuration diff and no pending edits.
2. One user commit exists after activation and no later edits exist: inspection shows that commit, no pending edits and the active-to-current diff. Active state is unchanged until activation.
3. Commits A and B exist after activation, followed by additional edits: inspection shows both commits, pending edits and one diff comparing active configuration with the latest files.
4. A supplementary prompt changes without a manifest change: current inspection includes its content diff and pending status.
5. Current JSON is malformed: inspection retains readable file content and validation issues; the active configuration remains available and unchanged.
6. User activates the reviewed committed configuration while pending edits exist: only the committed configuration becomes active. The pending files remain current; subsequent inspection compares them with the new active baseline and reports the remaining pending edits.

The [frontend design](../../frontend/design.md#member-tree-active-details-and-configuration-changes) defines a design-folder member tree, active hover/details and a separate Configuration changes view. Generic file review remains unchanged.

### HTTP inspection and operation contract

- `GET /workspaces/:workspaceId/team` returns the active roster with readiness/activity and derived harness scope.
- `GET /workspaces/:workspaceId/team/members/:memberId` returns `{member, configuration, harnesses}` with complete active source and effective rules. This read does not create additional checkouts.
- `GET /workspaces/:workspaceId/team/configuration/current` takes no query parameters and returns the fields below. It may initialize the shared workspace and capture a checkpoint; it does not commit files, change active settings or trigger work.
- `POST /workspaces/:workspaceId/team/configuration/commit` accepts only `{revision, base, message}` from the returned `commit` object plus user intent. It returns the harness commit result. The lead must be idle. Invalid pending configuration can be accepted as files, but cannot activate until a valid configuration is committed.
- `POST /workspaces/:workspaceId/team/configuration/activate` accepts only `{revision, digest}` from the returned `activation` object. It returns `{revision, changes, memberIds}` and requires the entire workspace idle.

Current inspection returns:

| Field | Meaning |
| --- | --- |
| `workspaceId`, `leadId` | Workspace and editing lead identity |
| `active: {revision, time}` | Last workspace member-config activation, nullable before tracking exists |
| `current: {revision, members, files}` | Immutable current file snapshot; parsed valid members contain path, optional existing member ID and validated fields; files contain path, raw content, byte size and optional preview problem |
| `changes` | Flat active-to-current file differences: path, add/modify/delete action, unified patch and truncation flag |
| `status: {hasPending, pendingPaths, valid, issues, commits, more, historyKnown}` | Pending relative to latest user commit; current validation; latest commit records after activation and history-boundary availability |
| `commit: {revision, base}` | Exact current snapshot and latest committed base for file acceptance |
| `activation: {revision, digest, valid, issues, hasChanges}` | Exact committed snapshot/review, independent committed validation and whether its activation boundary differs |

A validation issue contains path, code and message. Raw previews remain available even when a member cannot be parsed. Text previews are bounded to 1 MiB per file and 4 MiB total; binary/invalid UTF-8/over-limit files have null content and an explicit problem. Each file patch is bounded to 262,144 characters with an explicit truncation flag. Renames appear as deletion/addition. Commit records include revision, tree, kind, actor, message and epoch-millisecond time, newest first; at most 100 are returned and `more` marks additional history. The prototype does not page older inspection history. Generic file history remains separate.

The activation boundary is persisted atomically even when no member fields change. Replaying a successful activation review is stale; refreshing can review the same files against the new boundary. Before the first tracked activation, active source bytes supply the comparison baseline. A legacy team with earlier accepted sources or retirements and no workspace activation marker reports `historyKnown: false`; available history is not claimed to begin at an exact known activation. The next successful activation establishes that boundary. Active runtime loading continues using database source snapshots independently of the Git marker.

A changed pending snapshot or committed base refuses commit with `stale_revision`. Changed activation, active team, models or referenced designs refuse activation with `stale_revision`. Busy commit reports `member_busy`; busy activation reports `workspace_busy`; invalid activation reports `invalid_config`. Errors preserve active state and require refreshed review rather than silently selecting different bytes. Unknown request fields and query parameters are refused.


## Initial lead configuration

A newly created/adopted workspace already has a valid active lead assigned to metadata.json, using the workspace default model, no dependencies and the fixed broad execute base. Its exact JSON/Markdown source is materialized under .rsi/members before success. Bootstrap records the initial activation/history boundary, so initial current inspection has no pending edits, no active-to-current diff and no commits awaiting activation. Backend-owned bootstrap baselines are already active; subsequent changes retain normal user acceptance and idle activation requirements. Reopening does not reset pending files or activate them.

Working/dependency references identify exact system nodes by metadata.json. Each node contains Markdown design and implementation context in single-file or directory form; document count does not introduce additional assignments. Raw safe references are syntactically parsed before semantic node resolution so unavailable active assignments remain inspectable/unready. Submitted member configuration and run admission must resolve valid node metadata/design before granting code/context scope. No automatic old-layout assignment conversion occurs.

Only the lead edits designs. Other members follow their accepted working/dependency designs. Implementation context for both roles follows assigned nodes under implement/, while source code follows accepted mappings. Working/dependency permission views each contain design context, implementation context and implementation; global lead design management does not grant global implementation rights.

## User member model settings

Users may freely configure active members' provider/model selection and per-model reasoning, temperature, output-token limit and context budget using `GET`/`PUT /workspaces/:workspaceId/team/members/:memberId/model-settings`. GET returns `{id, revision, value, issues}`; value contains only `connectionId`, `modelId`, `modelOptions`. PUT accepts `{revision, value}` with the same complete model-only value. It rejects unknown fields and invalid settings and reports stale revisions with 409. A missing, retired or other-workspace member returns 404. Users may choose any available configured provider model, independently of workspace choices offered to agents.

These user settings are durable member data separate from the activated manifest source. Effective member inspection and readiness use these settings; exact manifest source and configuration diffs continue describing agent-managed files. User model edits do not create pending file changes, require file commit/activation, or grant agents a mutation tool. Later member-file activation preserves user settings. Existing file-update restrictions still apply to the manifest. New runs use the latest saved model settings, while already prepared runs retain their snapshot. Saves serialize with workspace control operations and use member revision protection; they are permitted while work runs.

## Conversation reset

Users may explicitly reset a workspace group chat and every member's runtime conversation history/context while the whole team is idle. This preserves members, configuration, models, project/context documents and harness state. Busy reset changes nothing. Shared observers clear the old conversation and future runs start without prior messages; normal history retention has this explicit destructive exception. Reset is a user HTTP control, never an agent capability.

The execute base admits arbitrary Bash for every active member. Existing execute.allowedCommands values remain validated source-format data for exact source/history continuity; they grant or deny no execution authority. No member-source rewrite, commit or activation is required to receive this fixed policy. Effective inspection tools/prompts describe broad execution and sandbox resource restrictions.

## Harness tool execution boundary

Workspace members receive native Pi file/search tools. Read-only tools inspect workspace content; write/edit enforce accepted assignment and role grants at invocation. Custom Bash supplies one persistent shell per member with system reads, whole-workspace/workspace-temp writes and networking. This broader Bash authority does not enforce working-design scopes. Pi content/details and native truncation are preserved. Custom results use readable content plus relevant metadata. Shells/jobs survive runs and stop on context reset, retirement, affected configuration activation/update, or shutdown. Foreground timeout/cancellation resets the member shell/jobs; background jobs use native job IDs and default their output to /dev/null unless explicitly redirected. Scoped Git acceptance and activation APIs retain their checks but do not claim to prevent all raw workspace changes.

## Lightweight Changes inspection

GET /workspaces/:workspaceId/team/changes returns workspaceId, leadId, design and member scope reviews ({memberId,partId,revision,base,changes}) plus activation {revision,activeRevision,hasChanges}. It reads fixed approved scope refs and current files; no full member validation, active-file materialization, raw configuration dump or commit-history enumeration occurs. activation.revision is the approved member commit; activeRevision is the last activated revision or null. A legacy missing activation marker conservatively reports changes; validation remains authoritative.

GET configuration?source=committed supplies the separate approved-configuration validation/digest. It may run after files display when approved and active differ. Existing commit/activate operations retain exact revision/digest, stale/busy checks and atomic activation; reading changes never approves or activates.
