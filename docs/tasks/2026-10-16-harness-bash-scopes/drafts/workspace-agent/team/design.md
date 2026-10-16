<!-- Task proposal; current contract is under docs/systems/ -->
# Team

## Purpose and boundary

The team belongs to one workspace and has two responsibilities: manage member creation, configuration and retirement; and coordinate work among members. The user and all active members participate in one shared workspace chat. The lead helps maintain the user design, divides work based on that design, configures harnesses and assigns members through shared responses. Members may be created or retired as the work changes. Designs and implementation survive member changes.

Members exist only inside their team and are absent from the global agent list and agent config API. Each retains its own private execution history alongside individually delivered shared messages. Model loops belong to the runtime, file authority and context delivery to the harness, and durable design records to the context base.

## Inputs and preconditions

### Member identity, files and effective harnesses

Each workspace has one unretirable lead and uniquely named active workers. Backend owns identities, revisions, source association and active settings. Editable member JSON contains name, role, responsibility, settings, promptFiles and designScope; referenced Markdown carries supplementary instructions. No version, memberId, revision, independent implementationScope or base-policy override belongs in the editable manifest.

Only the lead can read/edit .team/members among agents. Design/member files are pending harness content; user acceptance is required for their semantic commits. An accepted member-file Git commit does not activate settings. Configuration-change detection, validation-to-activation, self changes, creation/retirement through files and timing for active targets are deferred. The former submit_member_config and retire_member agent shortcuts are removed. Backend lifecycle methods retain identity, revision, model readiness and one-active-run checks.

Working/dependency references select accepted user designs. Writable implementation derives from working mappings and read-only use paths from dependencies; read-only wins overlaps. Control paths remain excluded. Pending mappings do not grant access. Base tools/prompts/policy are fixed. Three bases (management, implementation, execute) assemble common file tools, one Bash tool and lead list_models. General command allowances are backend-controlled and cannot override file/Git boundaries.

The lead has management bootstrap access to .context/user and .team/members before any design exists; implementation starts empty. Omitted backend-created member models/options use the workspace default. Model/default edits preserve already selected member settings. Invalid/unresolved designs or provider settings appear as readiness issues and prevent admission. Existing active members are migrated to design-only assignments without inventing a configuration activation policy.

### Work and cooperation

The user posts `{text}` to `POST /workspaces/:workspaceId/team/chat/messages`. Text is 1–20,000 characters. A user message without mentions triggers the lead. Explicit mentions select recipients using `@Name` or `@{Name With Spaces}`, matching active names ignoring case. A member response without mentions triggers nobody. Duplicate mentions select one recipient. All selected members may work in parallel, with at most one run per member.

Every accepted shared message is delivered to every active member, including the sender. Idle members append it to their continuing context immediately. Working members buffer incoming shared messages and append them in group order after their private work ends, without waiting for or triggering another activation. Each member context interleaves shared messages and its private work. Its previous private history remains available, but no other member receives it. Tool calls, results, intermediate responses and rejected publication candidates stay private. Only an accepted final response is published in the group transcript.

A final response is checked before the sending activation ends. If any recipient is unknown, retired, unready, self, or busy, the whole publication is refused: no shared message, recipient activation or budget consumption. The sender receives private feedback and can revise or retry within its current run. There is no queue, automatic wait or retry. A successfully published final response completes the sending activation before its recipients begin, so a recipient can mention the sender in its own response.

Each user-initiated exchange has a mention budget, initially 32 activations. Default lead routing counts one; each distinct recipient activation counts one. A response's activations belong to the same exchange. A message exceeding the remaining budget is refused in full. Already-started members can finish and publish without mentions. Cooperation ends when no members remain active. A new user message starts a new exchange and budget, subject to the same busy checks. `PUT /workspaces/:workspaceId/team/chat` with `{mentionLimit}` sets a 1–1,000 limit for later exchanges.

`GET /workspaces/:workspaceId/team/chat?after=0&limit=100` returns `{workspaceId, position, mentionLimit, messages, more, runs}` from persistent records. Messages contain author, text, recipients, stable ID, position, time and exchange ID; runs pair exchange IDs with runtime state. History pages contain 1–500 messages. `GET /workspaces/:workspaceId/team/chat/follow?after=0` synchronizes messages then follows shared messages and activation state across runs using version 1 `message`, `sync`, and `state` SSE events. A disconnected follower does not stop work. Group observation does not expose private execution traces.

`POST /workspaces/:workspaceId/team/chat/stop` stops existing exchanges and requests cancellation of active members. Later user messages may start new exchanges. Direct `POST /agents/:memberId/runs` refuses all team members; solo agents retain their own input API. Private member history/state/follow remains available for inspection. The [group chat contract](../../../../../systems/workspace-agent/team/group-chat/design.md) provides the complete cooperation boundary.

Every model call receives current role, roster/readiness/running information, stable active member instructions and assembled harness context. Shared design knowledge remains independent of member identity. Harness tool details and execution limits are defined by the [harness contract](../harness/design.md).

## Outputs and observable effects

Pending member/design files are checkpointed without acceptance. User review pins exact scope bytes and accepted base. Accepted member-file state, stable active settings and shared final publication are distinct. Prior active source remains stored independently of malformed/pending edits; there is no agent activation tool in this increment.

GET /workspaces/:workspaceId/team returns active members with readiness/running state and effective derived implementationScope for inspection. GET /workspaces/:workspaceId/team/members/:memberId returns {member, configuration, harnesses}. Configuration includes exact stable active JSON/Markdown bytes, path, digest, submitter/time and backend formatVersion. Harnesses contains management, implementation and execute definitions with effective parts, tools, prompts and commit policy. Inspection never opens a worktree or creates Git storage. Pending files are not projected into active settings. Member POST/PUT/DELETE and the separate member /config route remain absent.

Publication and creation of all selected run records remain atomic. Model execution starts after admission; failures become run status without fabricated shared output. Shared final messages and private histories remain database-backed and independent of context compaction.

## Failure behavior

Unsafe/unresolved designs, invalid settings, out-of-scope file/Git access, unapproved management commits and stale review/base state fail explicitly. Active settings and pending edits remain separate. Agent metadata cannot claim user approval or lead authority. Inspection uses standard HTTP error envelopes; missing/foreign/retired members return not_found.

Group messages retain atomic mention/readiness/busy/budget refusal behavior. Storage/checkpoint errors cannot be reported as successful acceptance/publication.

## Guarantees and limits

One lead, unique active names, ordered shared messages, retained private histories, parallel independent activation and accepted final responses only remain guaranteed. Among agents member paths are lead-only; management acceptance is user-only. Tools are reusable; runtime assembles harness capabilities.

Member JSON has backend-owned schema/revision bookkeeping outside the editable file. Migration preserves identities, settings, command rules, exact previous source, pending drafts and historical Git references. Existing drafts are not rewritten. Retired records stay historical. Effective implementation paths are derived and cannot be configured independently.

Configuration-change/activation/retirement/self-update workflow, new approval UI, richer execution rules, automatic context maintenance, durable run resume, trigger queues and multiple chats remain deferred. No new running-member update policy is introduced. Accepted file snapshots are not automatically merged into the original checkout or peer worktrees.

## Acceptance examples

1. Unmentioned user input starts the lead; its accepted final mentions Backend and Frontend and both run concurrently.
2. A busy mention refuses the entire publication, preserving private feedback without partial delivery.
3. Shared messages arriving during private work append after that work; idle members receive them immediately.
4. The lead edits member JSON/prompts, checkpoints, then asks for exact user review. An agent commit is refused; user file acceptance leaves active settings unchanged.
5. A worker reads its dependency design/implementation and edits its working implementation; member files remain inaccessible.
6. A pending mapping edit grants no new paths. User-approved design snapshots are used by semantic reads and harness scope resolution.
7. Inspection exposes all three fixed harnesses and derived paths from stable backend state without creating worktrees.
8. Stop/restart preserves private/public history and pending work; failed runs do not publish invented finals.

## Unified streaming and model completion

Members finish using ordinary assistant text at natural model completion. Tool calls continue the run; metadata-marked commentary continues privately. Truncated responses fail without publication. Final selection prefers explicitly final text blocks and otherwise uses unphased text at natural completion. The team checkpoints and offers the selected text for atomic group acceptance; refusal appends private feedback and continues. Only accepted finals reach peer context.
