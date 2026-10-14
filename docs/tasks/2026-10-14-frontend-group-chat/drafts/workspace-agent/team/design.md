<!-- Task proposal; current contract is under docs/systems/ -->
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
- Harness: `{designScope: {working: [paths], dependencies: [paths]}, allowedCommands: [rules]}`. Each design list has at most 50 distinct user-design files and no design belongs to both. Commands have at most 50 exact argument-vector or executable rules. A design record holds Markdown `content` and corresponding `implementation` files/directories. Working designs are read-only and their implementation editable; dependencies' design and implementation are read-only. `.` maps the project root, excluding `.git` and `.context`. Dependency read-only permissions take precedence on overlap.
- New members start with an empty harness unless configured. A worker needs nonempty resolvable design scope to run; a lead may start with an empty harness to help create the design. Issues combine model readiness, design resolution, empty worker scope and unsupported catalog selections.
- Creating/adopting a workspace creates its lead, named Lead, with no model, in the same step. Startup supplies a missing lead for older workspaces. Startup converts legacy agent-context scopes to empty harnesses once while preserving identity, conversations and settings; old scope does not grant new authority.
- Only the lead's tools create/change/retire other members. It cannot alter its own identity or settings through these tools, but can configure its own harness. HTTP can configure any member and retire any worker. Retired members leave the team view and free their names; their conversations remain readable.

### Work and cooperation

The user posts `{text}` to `POST /workspaces/:workspaceId/team/chat/messages`. Text is 1–20,000 characters. A user message without mentions triggers the lead. Explicit mentions select recipients using `@Name` or `@{Name With Spaces}`, matching active names ignoring case. A member response without mentions triggers nobody. Duplicate mentions select one recipient. All selected members may work in parallel, with at most one run per member.

Every accepted shared message is delivered to every active member, including the sender. Idle members append it to their continuing context immediately. Working members buffer incoming shared messages and append them in group order after their private work ends, without waiting for or triggering another activation. Each member context interleaves shared messages and its private work. Its previous private history remains available, but no other member receives it. Tool calls, results, intermediate responses and rejected publication candidates stay private. Only an accepted final response is published in the group transcript.

A final response is checked before the sending activation ends. If any recipient is unknown, retired, unready, self, or busy, the whole publication is refused: no shared message, recipient activation or budget consumption. The sender receives private feedback and can revise or retry within its current run. There is no queue, automatic wait or retry. A successfully published final response completes the sending activation before its recipients begin, so a recipient can mention the sender in its own response.

Each user-initiated exchange has a mention budget, initially 32 activations. Default lead routing counts one; each distinct recipient activation counts one. A response's activations belong to the same exchange. A message exceeding the remaining budget is refused in full. Already-started members can finish and publish without mentions. Cooperation ends when no members remain active. A new user message starts a new exchange and budget, subject to the same busy checks. `PUT /workspaces/:workspaceId/team/chat` with `{mentionLimit}` sets a 1–1,000 limit for later exchanges.

`GET /workspaces/:workspaceId/team/chat?after=0&limit=100` returns `{workspaceId, position, mentionLimit, messages, more, runs}` from persistent records. Messages contain author, text, recipients, stable ID, position, time and exchange ID; runs pair exchange IDs with runtime state. History pages contain 1–500 messages. `GET /workspaces/:workspaceId/team/chat/follow?after=0` synchronizes messages then follows shared messages and activation state across runs using version 1 `message`, `sync`, and `state` SSE events. A disconnected follower does not stop work. Group observation does not expose private execution traces.

`POST /workspaces/:workspaceId/team/chat/stop` stops existing exchanges and requests cancellation of active members. Later user messages may start new exchanges. Direct `POST /agents/:memberId/runs` refuses all team members; solo agents retain their own input API. Private member history/state/follow remains available for inspection. The [group chat contract](group-chat/design.md) provides the complete cooperation boundary.

The harness supplies `ls`, `read`, mapped `write` and `edit`, and `run_command` when command allowances exist. Generic tools cannot write context. The lead has additional member management, model listing, design read/save and harness configuration tools. Assignments are shared final responses, with objectives and mentions; there is no private messaging or blocking assignment tool. Each model call receives current role/roster/readiness/running information, run-snapshot standing instructions and current harness design/file context. Design/file sections are bounded at 64 KiB with omissions named. The lead also receives workspace context.

## Outputs and observable effects

Member changes advance revisions. Model and standing-instruction changes apply next run. Harness/configured mappings apply to subsequent tool invocations and model requests. New members inherit existing shared history. Retirement cancels active work, ends participation, preserves history and files, and allows name reuse. Historical group authors are preserved even after rename or retirement.

Publication and creation of all selected recipient run records are atomic. Model execution begins after acceptance; its failure becomes run status. A failed, cancelled or interrupted activation produces no fabricated shared response; already-published messages and completed file effects remain. Stopping a group exchange cancels all its active branches. Backend restart marks abandoned runs interrupted and delivers buffered messages after their private history, without replaying triggers.

## Failure behavior

Malformed fields/configuration fail with 400; unknown workspace/member with 404; duplicate name, stale revision, size limit, retiring the lead, direct member input, busy recipient or exhausted exchange budget with 409. Invalid mention syntax fails with 400; unknown mentioned names with 404. Invalid/unavailable harness or model refuses publication before acceptance. Refused publication leaves shared history and recipient execution unchanged. Expected publication failures return private feedback to an agent; persistence failures may end its run. Publication is not idempotent: do not blindly retry uncertain acceptance.

## Guarantees and limits

Exactly one unretirable lead, unique active names, shared ordered messages, retained private histories, independently triggered parallel members, and only accepted final responses shared between members. Design files and implementation mappings remain independent of membership. File tools do not sandbox permitted command effects. Model choices and decomposition are guided by instructions rather than deterministic guarantees.

No automated context maintenance, compaction policy, durable run resume, trigger queue, rich trigger rules or multiple chats per workspace. Mention tokens are routing syntax even inside code or quoted text; email addresses are ordinary text. Current frontend group-chat integration is deferred; backend APIs provide this cooperation mechanism, while the existing workspace composer still targets private lead input and receives refusal.

## Acceptance examples

1. An unmentioned user message starts the lead. Its final response mentions Backend and Frontend; both work concurrently and receive the same shared messages.
2. Backend reports with `@Lead`; Lead can work again after finishing its assignment response. Frontend sees the shared report without receiving Backend's private trace.
3. While Backend works, an accepted message mentioning only Frontend is appended to idle members and buffered for Backend. Backend receives it after finishing, without another activation.
4. A response mentions busy Backend and free Frontend: refuse the whole publication and let the sender revise privately.
5. A member can see every accepted shared message and still edit only its harness-authorized implementation. Proposed design changes are addressed to the lead.
6. Budget exhaustion refuses new activations. Existing branches can finish with unmentioned reports.
7. A replacement member receives the shared transcript and configured design scope, not the retired member's private execution history.
