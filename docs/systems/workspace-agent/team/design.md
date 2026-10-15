# Team

## Purpose and boundary

The team belongs to one workspace and has two responsibilities: manage member creation, configuration and retirement; and coordinate work among members. The user and all active members participate in one shared workspace chat. The lead helps maintain the user design, divides work based on that design, configures harnesses and assigns members through shared responses. Members may be created or retired as the work changes. Designs and implementation survive member changes.

Members exist only inside their team and are absent from the global agent list and agent config API. Each retains its own private execution history alongside individually delivered shared messages. Model loops belong to the runtime, file authority and context delivery to the harness, and durable design records to the context base.

## Inputs and preconditions

### Management

| Operation | Request | Response |
| --- | --- | --- |
| View team | `GET /workspaces/:workspaceId/team` | `{workspaceId, members}`, lead first, others in creation order |
| Create member | `POST /workspaces/:workspaceId/team/members`, `{name, role, responsibility?, harness?, settings?}` | 201, member |
| Read member | `GET /workspaces/:workspaceId/team/members/:memberId` | Member |
| Change member | `PUT /workspaces/:workspaceId/team/members/:memberId`, `{revision, value}` | Updated member |
| Retire member | `DELETE /workspaces/:workspaceId/team/members/:memberId`, `{revision}` | `{retired: memberId}` |

Member fields are `{memberId, workspaceId, revision, name, role, responsibility, harness, lead, settings, issues, ready, running}`. The member ID is its conversation ID. A full editable value contains `name`, `role`, `responsibility`, `harness`, and `settings`; the lead flag cannot change.

- Name: 1–40 letters, digits, spaces, `.`, `_`, `-`, starting and ending with a letter or digit, unique ignoring case among active members.
- Role: 1–80 characters without controls, a free-text label without automatic behavior. Responsibility: up to 4,000 characters, possibly empty. At most 20 active members including the lead.
- Settings: provider/model, prompts, instructions and per-model options follow the config contract. On creation omitted settings copy the lead except direct instructions start empty. Catalog tool selections must be empty: workspace tools come from the harness.
- Harness: `{designScope: {working: [paths], dependencies: [paths]}, implementationScope: {paths: [paths], usePaths: [paths]}, allowedCommands: [rules]}`. Each design list has at most 50 distinct user-design files and no design belongs to both. Commands have at most 50 exact argument-vector or executable rules. A design record holds Markdown `content` and corresponding `implementation` files/directories. Working designs are editable as pending files in the member worktree and require user approval to commit; explicit implementation paths permit agent commits; dependency designs and explicit implementation use paths are read-only. `.` maps the project root, excluding `.git`, `.context` and `.team`. Dependency read-only permissions take precedence on overlap.
- New members start with an empty harness unless configured. A worker needs a nonempty design or implementation assignment with all selected designs resolvable to run; a lead may start with an empty harness to help create the design. Issues combine model readiness, design resolution, empty worker scope and unsupported catalog selections.
- Creating/adopting a workspace creates its lead, named Lead, with no model, in the same step. Startup supplies a missing lead for older workspaces. Startup converts legacy agent-context scopes to empty harnesses, and freezes existing design-mapped implementation assignments into explicit path lists once. It retains identity, conversations, settings and command allowances. Missing/invalid old design mappings grant no implementation paths.
- Only the lead can submit member configuration or retire workers through tools. Submission updates require an idle target, including self; a lead cannot alter its own identity/settings through submission. HTTP can configure any member and retire any worker. Retired members leave the team view and free their names; their conversations remain readable.

### Work and cooperation

The user posts `{text}` to `POST /workspaces/:workspaceId/team/chat/messages`. Text is 1–20,000 characters. A user message without mentions triggers the lead. Explicit mentions select recipients using `@Name` or `@{Name With Spaces}`, matching active names ignoring case. A member response without mentions triggers nobody. Duplicate mentions select one recipient. All selected members may work in parallel, with at most one run per member.

Every accepted shared message is delivered to every active member, including the sender. Idle members append it to their continuing context immediately. Working members buffer incoming shared messages and append them in group order after their private work ends, without waiting for or triggering another activation. Each member context interleaves shared messages and its private work. Its previous private history remains available, but no other member receives it. Tool calls, results, intermediate responses and rejected publication candidates stay private. Only an accepted final response is published in the group transcript.

A final response is checked before the sending activation ends. If any recipient is unknown, retired, unready, self, or busy, the whole publication is refused: no shared message, recipient activation or budget consumption. The sender receives private feedback and can revise or retry within its current run. There is no queue, automatic wait or retry. A successfully published final response completes the sending activation before its recipients begin, so a recipient can mention the sender in its own response.

Each user-initiated exchange has a mention budget, initially 32 activations. Default lead routing counts one; each distinct recipient activation counts one. A response's activations belong to the same exchange. A message exceeding the remaining budget is refused in full. Already-started members can finish and publish without mentions. Cooperation ends when no members remain active. A new user message starts a new exchange and budget, subject to the same busy checks. `PUT /workspaces/:workspaceId/team/chat` with `{mentionLimit}` sets a 1–1,000 limit for later exchanges.

`GET /workspaces/:workspaceId/team/chat?after=0&limit=100` returns `{workspaceId, position, mentionLimit, messages, more, runs}` from persistent records. Messages contain author, text, recipients, stable ID, position, time and exchange ID; runs pair exchange IDs with runtime state. History pages contain 1–500 messages. `GET /workspaces/:workspaceId/team/chat/follow?after=0` synchronizes messages then follows shared messages and activation state across runs using version 1 `message`, `sync`, and `state` SSE events. A disconnected follower does not stop work. Group observation does not expose private execution traces.

`POST /workspaces/:workspaceId/team/chat/stop` stops existing exchanges and requests cancellation of active members. Later user messages may start new exchanges. Direct `POST /agents/:memberId/runs` refuses all team members; solo agents retain their own input API. Private member history/state/follow remains available for inspection. The [group chat contract](group-chat/design.md) provides the complete cooperation boundary.

The harness supplies `ls`, `read`, scoped `write` and `edit`, `commit_scope`, `scope_history`, `restore_scope`, and `run_command` when command allowances exist. Common file tools can edit pending working-design context in the member worktree; dependency/agent context remains read-only. The lead has submit_member_config, retire_member and list_models; structured agent create/update/configure tools are removed. Assignments are shared final responses, with objectives and mentions; there is no private messaging or blocking assignment tool. Each model call receives current role/roster/readiness/running information, run-snapshot standing instructions and current harness design/file context. Design/file sections are bounded at 64 KiB with omissions named. The lead also receives workspace context.

## Outputs and observable effects

Member changes advance revisions. Model and standing-instruction changes apply next run. Accepted explicit harness assignments apply to subsequent tools/requests; harness scope changes require an idle target. User model-setting changes can be saved during a run and apply next run. Pending configuration files are inactive. Group admission refuses a member revision changed after its model snapshot was prepared. New members inherit existing shared history. Retirement cancels active work, ends participation, preserves history and files, and allows name reuse. Historical group authors are preserved even after rename or retirement.

Publication and creation of all selected recipient run records are atomic. Model execution begins after acceptance; its failure becomes run status. A failed, cancelled or interrupted activation produces no fabricated shared response; already-published messages and completed file effects remain. Stopping a group exchange cancels all its active branches. Backend restart marks abandoned runs interrupted and delivers buffered messages after their private history, without replaying triggers.

## Failure behavior

Malformed fields/configuration fail with 400; unknown workspace/member with 404; duplicate name, stale revision, size limit, retiring the lead, direct member input, busy recipient or exhausted exchange budget with 409. Invalid mention syntax fails with 400; unknown mentioned names with 404. Invalid/unavailable harness or model refuses publication before acceptance. Refused publication leaves shared history and recipient execution unchanged. Expected publication failures return private feedback to an agent; persistence failures may end its run. Publication is not idempotent: do not blindly retry uncertain acceptance.

## Guarantees and limits

Exactly one unretirable lead, unique active names, shared ordered messages, retained private histories, independently triggered parallel members, and only accepted final responses shared between members. Design files and implementation mappings remain independent of membership. File tools do not sandbox permitted command effects. Model choices and decomposition are guided by instructions rather than deterministic guarantees.

No automated context maintenance, compaction policy, durable run resume, trigger queue, rich trigger rules or multiple chats per workspace. Mention tokens are routing syntax even inside code or quoted text; email addresses are ordinary text. The frontend uses the group-chat timeline and private history APIs. Harness configuration and approval UI are deferred; backend review/history/acceptance/restore operations are available under the member harness boundary.

## Acceptance examples

1. An unmentioned user message starts the lead. Its final response mentions Backend and Frontend; both work concurrently and receive the same shared messages.
2. Backend reports with `@Lead`; Lead can work again after finishing its assignment response. Frontend sees the shared report without receiving Backend's private trace.
3. While Backend works, an accepted message mentioning only Frontend is appended to idle members and buffered for Backend. Backend receives it after finishing, without another activation.
4. A response mentions busy Backend and free Frontend: refuse the whole publication and let the sender revise privately.
5. A member can see every accepted shared message and still edit only its harness-authorized implementation. Pending design edits require user approval to commit; implementation commits follow harness permission.
6. Budget exhaustion refuses new activations. Existing branches can finish with unmentioned reports.
7. A replacement member receives the shared transcript and configured design scope, not the retired member's private execution history.

Each member uses a separate managed worktree. The harness automatically checkpoints finished runs and before successful final group publication. Scoped committed snapshots remain in harness Git; they are not automatically integrated into the original workspace or existing peer worktrees. User acceptance pins exact reviewed bytes/base and is scoped to one part; implementation commits never accept pending design. The [harness contract](../harness/design.md) specifies these operations and permissions.

## File-based configuration submission

The lead creates or updates a member by editing `.team/members/<bundle>/member.json` and Markdown files under that bundle's `prompts/` directory, using common file tools, then calling `submit_member_config({path})`. The manifest format is version 2, with memberId/revision (null/null for creation), name, role, responsibility, settings (without inline prompt), ordered promptFiles, and harnesses.project {designScope: {working, dependencies}, implementationScope: {paths, usePaths}}. References are relative to the bundle and stay inside prompts/. Existing member configuration is discoverable in the lead worktree; missing draft files are recreated from the last submitted bundle without overwriting existing edits. Editing a referenced prompt requires resubmission.

Submission captures exact manifest/prompt contents, validates structure, model settings, design references, safe scopes, lead authority, revision and target availability, and atomically persists the complete accepted bundle with its derived member configuration. An invalid or stale submission activates nothing. Running targets refuse updates; the lead cannot submit a self-update during its own run. New members inherit the lead's current existing command allowances; updates preserve the target's allowances. The separate command harness uses existing allowances; richer boundary rules and agent configuration remain deferred. Configuration files cannot set fixed tools, harness maintenance prompts or approval policy. Member prompts supplement fixed base rules.

Runtime reads accepted configuration and submitted prompt contents rather than mutable files. Durable storage retains the accepted source bundle, hash and author/time; its member fields are a validated projection. User management HTTP edits persist a generated accepted JSON/Markdown bundle through the same member write, preserving frontend settings use without a new UI. Stable bundle reads are available at GET /workspaces/:workspaceId/team/members/:memberId/config. Existing draft copies are never silently overwritten by user changes; stale revision submission requires reconciliation. Agent-facing structured create/update/configure tools are removed; retirement and model listing remain. Existing stored assignments migrate once to explicit implementation paths, after which design mappings no longer grant permissions.

File submission validates model/provider/catalog references before the member write; invalid or incomplete run settings preserve the accepted bundle. User HTTP settings edits can still retain incomplete selections for later repair.

Startup upgrades accepted version 1 active-member bundles to version 2 project grouping, retaining prompt files, assignments and command allowances while advancing member revisions. Existing draft files are preserved; old drafts must be regrouped under harnesses.project and reconciled with the current revision before submission. Scope Git parts and histories do not change merely because their harness is combined.

The existing member view and user HTTP value keep flat harness assignment fields: designScope and implementationScope project into the combined project harness, while allowedCommands projects into the separate command harness. The version 2 editable manifest exposes only the project assignment.

Retired members retain their historical accepted bundle format and revision; initialization does not replay retirement effects solely to upgrade their config representation.
