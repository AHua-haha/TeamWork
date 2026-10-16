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

Working mappings grant writable implementation and dependency mappings grant read-only implementation, with read-only precedence and protected control paths. Base tools and enforced policy cannot be changed through member prompt or execution configuration. The lead keeps management bootstrap access to .context/user and .team/members; unassigned implementation access remains empty.

### Member change workflow

The workflow is edit -> validate -> user commit -> separate user activation. Pending files, user-committed files and active configuration are distinct states. Validation reports create/update/delete changes and issues; it neither accepts files nor activates settings. Invalid files preserve previous stable active configuration and pending work. Intentional deletions remain pending rather than being recreated by discovery/materialization; a missing referenced prompt is an error, not a member deletion.

Only the user commits member configuration. The user reviews and commits exact file content under the existing member-config scope policy. Commit does not create, update or retire active members. Later, only the user can activate the reviewed committed change set. Uncommitted edits are excluded from activation and remain pending.

Activation requires the entire workspace team to be idle, including admitted runs and outstanding model/tool/finalization work. It applies the complete reviewed change set atomically. It neither stops running work nor queues an automatic retry. New work admission cannot race through the idle check. Activation does not trigger any member.

Activation revalidates the exact committed snapshot against current active configuration and relevant design/model state. Invalid, stale or busy activation changes nothing: no partial roster/source/settings updates, no member runs, and previous active state remains available. A changed accepted/configuration base requires fresh review. After activation, later group input uses the resulting team; new members receive shared history, updates retain private history and deleted members remain historical.

The editable JSON fields are name, role, responsibility, settings, promptFiles, designScope and execute: {allowedCommands}. Prompt references are ordered safe bundle-relative prompts/*.md paths (at most 20); relevant files must be UTF-8 text within existing text limits. Unknown fields/base overrides are invalid. Backend envelope formatVersion 4 and acceptedRevision belong to metadata outside those files. Startup converts active older source envelopes once, preserving previous exact source/settings/commands and existing drafts. Legacy drafts are not rewritten; reconcile their schema before validation. Retired bundle paths cannot be reused for a new identity; use a fresh bundle.

The lead calls validate_member_config({path: ".team/members"}) for the whole pending change set. It has no commit or activation authority. Member names must remain unique in the resulting team (at most 20); a create/delete replacement may reuse a retiring member name within the batch. No structured agent create/update/delete or activation tool bypasses the file/validation/user-acceptance flow. Member inspection remains read-only and distinguishes active source from pending or committed-but-inactive files.

### Work and cooperation

The user posts `{text}` to `POST /workspaces/:workspaceId/team/chat/messages`. Text is 1–20,000 characters. A user message without mentions triggers the lead. Explicit mentions select recipients using `@Name` or `@{Name With Spaces}`, matching active names ignoring case. A member response without mentions triggers nobody. Duplicate mentions select one recipient. All selected members may work in parallel, with at most one run per member.

Every accepted shared message is delivered to every active member, including the sender. Idle members append it to their continuing context immediately. Working members buffer incoming shared messages and append them in group order after their private work ends, without waiting for or triggering another activation. Each member context interleaves shared messages and its private work. Its previous private history remains available, but no other member receives it. Tool calls, results, intermediate responses and rejected publication candidates stay private. Only an accepted final response is published in the group transcript.

A final response is checked before the sending activation ends. If any recipient is unknown, retired, unready, self, or busy, the whole publication is refused: no shared message, recipient activation or budget consumption. The sender receives private feedback and can revise or retry within its current run. There is no queue, automatic wait or retry. A successfully published final response completes the sending activation before its recipients begin, so a recipient can mention the sender in its own response.

Each user-initiated exchange has a mention budget, initially 32 activations. Default lead routing counts one; each distinct recipient activation counts one. A response's activations belong to the same exchange. A message exceeding the remaining budget is refused in full. Already-started members can finish and publish without mentions. Cooperation ends when no members remain active. A new user message starts a new exchange and budget, subject to the same busy checks. `PUT /workspaces/:workspaceId/team/chat` with `{mentionLimit}` sets a 1–1,000 limit for later exchanges.

`GET /workspaces/:workspaceId/team/chat?after=0&limit=100` returns `{workspaceId, position, mentionLimit, messages, more, runs}` from persistent records. Messages contain author, text, recipients, stable ID, position, time and exchange ID; runs pair exchange IDs with runtime state. History pages contain 1–500 messages. `GET /workspaces/:workspaceId/team/chat/follow?after=0` synchronizes messages then follows shared messages and activation state across runs using version 1 `message`, `sync`, and `state` SSE events. A disconnected follower does not stop work. Group observation does not expose private execution traces.

`POST /workspaces/:workspaceId/team/chat/stop` stops existing exchanges and requests cancellation of active members. Later user messages may start new exchanges. Direct `POST /agents/:memberId/runs` refuses all team members; solo agents retain their own input API. Private member history/state/follow remains available for inspection. The [group chat contract](../../../../../systems/workspace-agent/team/group-chat/design.md) provides the complete cooperation boundary.

Every model call receives current role, roster/readiness/running information, stable active member instructions and assembled harness context. Shared design knowledge remains independent of member identity. Harness tool details and execution limits are defined by the [harness contract](../harness/design.md).

## Outputs and observable effects

Pending member/design files are checkpointed without acceptance. User commit pins exact scope bytes and accepted base. User activation separately changes the stable active member source/projection in one atomic batch. Member identity, revisions, content attribution and exact prompt bytes remain backend-managed and durable.

Read-only team/member inspection continues returning active configuration, readiness/running state and the three effective harnesses with backend-derived implementation paths. GET /workspaces/:workspaceId/team returns active members; GET /workspaces/:workspaceId/team/members/:memberId returns {member, configuration, harnesses}. Configuration contains exact active JSON/Markdown source, path, digest, attribution/time and backend format metadata. Member POST/PUT/DELETE and member /config mutation routes remain absent. It does not activate drafts or create worktrees. User activation is a dedicated control operation; agent authority remains file editing and validation, not activation.

Group publication and selected run admission remain atomic and database-backed. Execution failure becomes status without fabricated shared output. Shared final messages and private histories remain independent of context compaction. File commit, member activation and shared final publication are separate effects.

## Failure behavior

Invalid schemas/paths/models/designs, forbidden updates, lead deletion, duplicate names, unsafe prompt references and base-policy overrides refuse the change set. Invalid references do not grant permissive scope. Metadata cannot claim lead/user authority.

Busy, stale or failed activation leaves the entire active team unchanged and retains committed/pending files. Group mention/readiness/budget/busy refusals remain atomic. Storage/checkpoint errors cannot be claimed as successful file acceptance, activation or publication.

## Guarantees and limits

One lead, unique active names, ordered shared messages, retained private histories, parallel independent activation and accepted shared final responses remain guaranteed. Configuration activation is user-only, workspace-idle and atomic. Its separate user commit prerequisite cannot be inferred from a run completion or an agent statement.

Schema/version/identity bookkeeping stays outside editable manifests. Migration preserves identities/settings, exact prior source, pending drafts and historical Git references. An accepted update cannot change assignment/name/role/model settings. Execute changes cannot override protected filesystem/Git authority.

No automatic configuration activation, automatic stop/retry, new trigger queue, multiple-chat model, durable run resume, automatic context-maintenance algorithm or original/peer-worktree merge is introduced. Frontend activation presentation is separate from this backend contract. Accepted design-mapping refresh continues its existing authority semantics.

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

## User review and activation API

- GET /workspaces/:workspaceId/team/configuration?source=pending validates/captures pending files; source=committed (the default) reviews the current user-committed member-config snapshot. This operational review can initialize harness storage, unlike ordinary read-only member inspection.
- Review returns {origin, revision, digest, valid, changes, issues}. Changes are create/update/delete with paths, current member identity where applicable, proposed fields and exact before/after source bundles. Issues identify path, code and reason. A baseline without a user commit cannot activate.
- The existing harness member-config review/commit endpoint remains the separate user file-acceptance operation. File commit alone may retain invalid file content; activation always revalidates it and refuses invalid configuration.
- POST /workspaces/:workspaceId/team/configuration/activate with {revision, digest} activates exactly that reviewed committed change set. No actor/approval fields are accepted. Success returns {revision, changes, memberIds}; changes are summaries and memberIds is the resulting active roster. No model run starts.
- Changed review/active/model/design state returns stale_revision (409); workspace work/admission/finalization returns workspace_busy (409); invalid configuration returns invalid_config (400). Active state remains unchanged on refusal. Old request bodies become stale after changes activate; obtain a fresh review. A valid fresh no-change activation does not advance member revisions.

The user must commit before activation. Later pending file edits neither change the committed review nor get consumed by activation. No automatic watcher or agent activation endpoint/tool exists. Frontend activation controls are not added in this backend prototype.
