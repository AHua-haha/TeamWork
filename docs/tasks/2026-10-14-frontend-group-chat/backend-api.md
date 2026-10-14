> Historical API review at task start commit ad27b9630c7332782658d7a21b116b43c6b88a22. The implemented timeline extension is specified in the task backend group-chat draft and backend README.

# Backend interface for the workspace group-chat frontend

Inspected implementation: ad27b9630c7332782658d7a21b116b43c6b88a22. This document records implemented behavior; UI recommendations belong to the subsequent design discussion.

## Consumer model

- One shared chat belongs to each workspace. The user and all active members participate.
- Group messages are persistent accepted user text or member final responses. Private working messages, tool results and rejected publication candidates are separate.
- Member activation status is separate from the shared transcript. A failed run need not have a shared response.
- Backend history reads come from the database; frontend connections do not drive execution or own agent context.

## Shared message

```ts
type ChatAuthor =
  | { type: "user" }
  | { type: "member"; memberId: string; name: string; runId: string };

interface ChatMessage {
  workspaceId: string;
  messageId: string;
  position: number;
  exchangeId: string;
  author: ChatAuthor;
  text: string;
  recipients: string[]; // resolved member IDs, including default Lead routing
  time: number;        // epoch milliseconds
}
```

`position` starts at 1 and orders the workspace transcript. `messageId` identifies the same accepted record across history reads, POST acknowledgement and SSE. `author.name` preserves the publishing member's name at publication. `recipients` identifies triggered members; all active members receive the shared message. Plain text can be rendered as Markdown by the frontend. Group messages are not Pi message objects and contain no tool-card payloads or attachments.

An exchange starts with each accepted user message and includes downstream member activations. Several exchanges may coexist while different members work.

## Chat operations

All paths below use `/workspaces/:workspaceId/team/chat` as their base. JSON errors use `{error: {code, message}}`.

| Operation | Request | Response and meaning |
| --- | --- | --- |
| Read shared history and activity | `GET ?after=0&limit=100` | 200, `{workspaceId, position, mentionLimit, messages, more, runs}` |
| Publish user text | `POST /messages`, JSON `{text}` | 202, `{message, runs}`; accepted shared message and newly started run records |
| Follow shared history/activity | `GET /follow?after=0` | Persistent SSE, initially history then synchronization and state; remains open across runs and idle periods |
| Configure later exchange budgets | `PUT`, JSON `{mentionLimit}` | 200, chat snapshot; limit is 1–1,000, default 32; already-started exchanges keep their old limit |
| Stop current group work | `POST /stop` | 202, `{stopped: true}`; existing exchanges are fenced and active runs receive cancellation requests |

`text` must be nonblank and at most 20,000 JavaScript string units. Only `text` is accepted in the publish body. Shared history has no edit/delete operation.

History `limit` is 1–500. Top-level `position` is the latest transcript position, which can be beyond the returned page. Continue paging from the last returned message's position, not from that top-level watermark. `more` indicates additional records. `after` beyond current history fails with 409 `invalid_cursor`. `runs` currently contains all stored chat activations for the workspace, not only active ones, and is not chronologically sorted or paginated.

Publication and recipient run creation are atomic. A successful acknowledgement means publication was accepted; member execution can subsequently fail. Losing the response does not prove rejection. Publication is not idempotent and has no client request ID: do not automatically resend after network failure or uncertain server failure.

## Mention and availability rules

- User text without mentions activates Lead. Explicit mentions activate only their recipients.
- Syntax: `@Backend` or `@{Backend Worker}`. Match active names ignoring case; repeated mentions of the same member in one message activate once.
- Mention tokens inside quoted text or code still route work. Email addresses are ordinary text.
- Multiple recipients run independently in parallel, with at most one run per member.
- Any busy, unknown, retired or unready recipient refuses the whole publication. There is no partial acceptance, queue or automatic retry. A member cannot mention itself in its final response.
- Unmentioned member responses activate nobody. All accepted responses remain shared with everyone.
- Idle recipients' contexts update immediately. Working members buffer shared messages and append them after their private work. The frontend does not deliver or manipulate these contexts.
- A user can address a free member while another member is busy. Sending need not be globally disabled by workspace activity. Server admission remains authoritative because availability can change after a roster read.

Common refusal codes: `invalid_input` (400), `not_found` (404), `member_busy`, `member_unavailable`, `invalid_agent_config`, and `mention_limit` (409). Conflicts/refusals leave the candidate unpublished. Agent-side refusal feedback stays private and is not a group event.

## Group follow protocol

Each event contains `{version: 1, type, workspaceId}`; its SSE event name equals `type`.

| Event | Additional fields | Frontend meaning |
| --- | --- | --- |
| `message` | `message: ChatMessage` | One complete persistent shared record |
| `sync` | `position` | Initial history through this position has been delivered |
| `state` | `mentionLimit`, `runs: [{exchangeId, run}]` | Replace the chat settings/activity snapshot |
| `stream_error` | `code`, `message` | Streaming failed; reconnect and synchronize |

Initial order is history `message` events, `sync`, then `state`. Later message/state events arrive as chat activity changes. Group follow has no private chunks, partial drafts, tool events, chunk gaps or per-run `end` event. EOF means reconnect or a closed backend, not proof that member work finished. Disconnecting or leaving a page does not cancel work. Keepalive comments carry no state.

Reconnect using the last contiguous applied group position. POST acknowledgement and SSE can deliver the same message in either order: deduplicate by workspace/position/message identity. A POST record arriving ahead of older stream records must not advance the reconnect cursor past unapplied positions.

## Activation state

```ts
interface RunState {
  agentId: string; // the member ID
  runId: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  phase: "model" | "tools" | "finished";
  step: number;
  startedAt: number;
  endedAt: number | null;
  endPosition: number | null;
  activeMessageId: string | null;
  error: {code: string; message: string} | null;
}
```

Use `status === "running"` to identify working members. Match `agentId` to the current roster for names and roles. Historical member names can be retained from message authors; the roster API lists active members only. `endPosition` is a private agent-history bound and is not a group-history cursor.

The stream emits state when its settings/run snapshot changes. It wakes on group publication/admission, settings updates, cancellation/retirement and run termination; a wakeup with an unchanged snapshot emits no new state. Private step/phase changes do not independently notify the group stream. The current API supports working/terminal status; it does not provide continuously streamed private progress. Stop acknowledgement precedes guaranteed terminal run observation; completed messages/files remain.

The current API exposes the configured mention limit, not each exchange's frozen limit, used budget or remaining budget. Do not invent a remaining-budget indicator from the current setting. It provides no delivery/read receipts or per-member buffered-message indicator.

## Current supporting APIs

| Frontend use | Backend interface |
| --- | --- |
| Workspace navigation/registration | `GET/POST /workspaces`; `GET /workspaces/:id` |
| Current members, roles, harnesses and readiness | `GET /workspaces/:id/team`; `GET /workspaces/:id/team/members/:memberId` |
| Member configuration | `POST /workspaces/:id/team/members`; `PUT /workspaces/:id/team/members/:memberId` with `{revision,value}`; `DELETE` with `{revision}` |
| Current design list/read | `GET /workspaces/:id/designs`; `GET /workspaces/:id/designs/file?path=...` |
| Project and context files | Existing `/workspaces/:id/files/*` and `/workspaces/:id/context/*` APIs |
| Context/design file changes | `GET /workspaces/:id/context/follow?after=...` |
| Provider/model choices | Existing `/config/connections`, `/config/connections/:id/models`, `/config/connections/:id/models/refresh` and `/config/capabilities` APIs |

Team records contain `{memberId, workspaceId, revision, name, role, responsibility, harness, lead, settings, issues, ready, running}`. Updating settings must preserve other editable fields and use the current member revision. Settings changes affect the next run; harness authority remains current per operation. Lead settings are member settings, not an agent-config record.

There is no dedicated roster-change stream. Group activity notifications do not themselves contain member-management changes. Read the team on open/focus, after relevant activity, or explicit refresh. Existing design/context follow behavior remains useful for the right panel. Backend member-management endpoints exist, but whether the frontend exposes them is a UI decision; the previous UI agreement leaves team formation to Lead.

## Private inspection and solo conversations

`GET /agents/:memberId/state`, `GET /agents/:memberId/follow?runId=...&after=...`, and `POST /agents/:memberId/runs/:runId/cancel` remain available for private inspection/control. Private follow has its own history cursor, Pi messages/chunks and per-run end semantics. It must not be merged into the shared transcript.

Direct `POST /agents/:memberId/runs` refuses every team member, including Lead, with 409 `member_conversation`. Members have no `/agents/:id/config`. Solo agents keep the existing `/agents` input, follow, cancellation and config APIs.

## Verified source map

- [Group records and mention parsing](../../../backend/src/group-chat.ts)
- [Group HTTP routes](../../../backend/src/team-routes.ts)
- [Publication, scheduling and follow](../../../backend/src/team-runner.ts)
- [Database-backed history and state](../../../backend/src/database.ts)
- [Private runtime protocol](../../../backend/src/types.ts)
- [Current group chat contract](../../systems/workspace-agent/team/group-chat/design.md)
