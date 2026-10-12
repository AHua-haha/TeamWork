# Team

## Purpose and boundary

The team belongs to one workspace and has two responsibilities: manage member creation, configuration and retirement; and coordinate work among members. The user talks to its lead, which helps maintain the user design, divides work based on that design, configures harnesses and assigns members. Members may be created or retired as the work changes. Designs and implementation survive member changes.

Members exist only inside their team and are absent from the global agent list and agent config API. Each has its own continuing conversation. Model loops belong to the runtime, file authority and context delivery to the harness, and durable design records to the context base.

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

The user sends `{input}` to `POST /agents/:memberId/runs` for the lead, receiving 202 and the run. Input to a worker is refused. One active lead run is allowed; another input fails busy and is never queued.

Every member has `send_message(to, text)`, where text is 1–20,000 characters. The recipient receives a user message prefixed with the caller's name, works in its own conversation, and returns only its final assistant text. The caller waits. The lead additionally has member-management, model-listing, design-read/save, harness-configuration and design-based assignment tools. An assignment objective is combined with the recipient's current design references within the same text limit.

The harness supplies `ls`, `read`, and, when working implementation is mapped, `write` and `edit`. It supplies `run_command` only when command allowances exist. Generic file tools cannot write context. Workers see selected designs and mapped implementation; the lead may read the workspace to help design it. Allowed command matching is implemented; filesystem confinement of permitted commands is deferred. Arbitrary catalog tools are not supplied to members.

Every model call receives current member identity, responsibility, roster/readiness, run-snapshot standing instructions, current working/dependency designs and mapped implementation content. Each file-content section is bounded at 64 KiB and names omitted files. The lead also receives workspace context. Prior conversation messages remain; automatic maintenance is deferred.

## Outputs and observable effects

Member changes update revisions. Model and standing-instruction changes apply next run. Harness/configured design mappings apply to subsequent tool invocations and model requests; the roster refreshes each model call. Reads create nothing. Retiring cancels the member's active run and leaves written files and durable designs intact.

Calls execute sequentially. Every user chain begins with the lead, contains no member twice, and has at most five members. Workers can call other workers; they return questions for the lead in their report because calling an ancestor is refused. A final report is cut at 20,000 characters with a note; no text returns a note. Member reasoning and tool steps are not copied into the caller conversation.

Stopping the caller cancels the recipient and any descendants. Completed effects remain. A completed, failed, cancelled or interrupted recipient ends its call; no automatic retry or resume occurs. Conversations can be observed through runtime history/state/follow, while the application displays only the lead.

## Failure behavior

Malformed fields/configuration fail with 400; unknown workspace/member with 404; duplicate name, stale revision, size limit, retiring the lead, worker user input, or busy run with 409. Unavailable folder/storage fails explicitly. Refused management changes leave records unchanged. Expected tool refusals return normal results so the caller can recover; storage failures may end the run.

Calls refuse unknown names, the caller itself, members already in the chain, a sixth member, busy or unready recipients, and invalid text. A failed recipient returns its failure reason. A cancelled or interrupted recipient returns that outcome. The backend shutdown interrupts active runtime runs; calls do not resume automatically.

## Guarantees and limits

Exactly one unretirable lead per team, unique active names, persistent member conversations, no agent-config identity for members, sequential noncyclic calls, and only final reports crossing the call boundary. Design files and their implementation mappings are independent of membership. Permissions enforced by file tools do not sandbox permitted command effects. Model-generated decomposition and explanations are guided by instructions rather than deterministic guarantees.

One lead conversation only grows; no compaction, automated harness-context maintenance, parallel workers, queues, rich cooperation rules or workspace reassignment. A retired member cannot return; a new member can receive its design scope. File tools support text up to 1 MiB and do not provide search or version-control-specific actions.

## Acceptance examples

1. A new workspace has Lead, not ready until the user chooses a model. Reading its team again changes nothing.
2. Lead saves a backend design with implementation `backend/src`, creates Backend and configures its working design plus API dependency. Backend becomes ready with the inherited model.
3. Lead assigns Backend. It reads both designs, edits only backend implementation, and returns a report. The lead sees the report, and the user sees the assignment card and response.
4. Backend edits dependency implementation or either design through file tools: refused. A proposed design change is returned to the lead for discussion.
5. Backend calls Frontend; Frontend cannot call Backend or Lead in that chain. Stopping Lead cancels both. Their completed writes remain.
6. Retiring Backend frees its name and preserves its design. A replacement Backend receives the same design references.
7. An old stored scope migrates to an empty harness; its worker cannot run until its design scope is configured.
