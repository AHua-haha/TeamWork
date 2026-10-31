---
summary: Exposes canonical local HTTP JSON, image and SSE resources for agents, configuration, workspaces, members, team chat and read-only context inspection.
include:
  - backend/src/api/
  - backend/test/team-routes.test.ts
  - backend/test/workspace-routes.test.ts
  - backend/test/chat-images.test.ts
---

# API usage contract

**Input:** `createAgentServer(runtime, config, workspaces, team)`; HTTP JSON or multipart bodies, paths/query revisions and cursors.

**Output:** An unbound HTTP server; JSON/error envelopes, image responses and SSE frames. Existing route names, payloads, cursor ordering and final-reference semantics are unchanged.

**Effect and failure:** Transport consumes sockets and stream subscriptions; semantic decisions and persistence remain Core-owned. Disconnects release follow resources without pretending to cancel independent runs.

**Usage example:** `const server = createAgentServer(runtime, config, workspaces, team); server.listen(port, host);` For browser use, `GET /agents` lists solo agents. `GET /workspaces/:id/chat/timeline?after=0&limit=100` returns ordered timeline changes; follow using its change cursor.

## Context inspection

**Group summary:** `GET /workspaces/:workspaceId/chat/summary` accepts no query parameters and returns 200 `{summary:GroupSummary|null,retainedMessages:30}` with `Cache-Control:no-store`. The saved summary includes revision, from, through (summarized prefix end), analyzedThrough (pinned snapshot end), sourceDigest, text, messageId and time. Team checks workspace scope before reading; missing workspace is 404, unknown queries are 400, writes/extra segments are 404. Reads never start generation. The old semantic-index endpoint returns 404.

**Input:**

- `GET /workspaces/:workspaceId/members/:memberId/context`: current durable context of an active member in this workspace.
- `GET /workspaces/:workspaceId/chat/context`: current effective shared group context (accepted summary plus original tail).

Both accept only optional `offset`, `limit`, `revision` query parameters as nonnegative decimal integers. Offset defaults to 0, limit to 50 (allowed 1–100). A request with offset greater than 0 must include the revision returned by the first page. Unknown/repeated parameters and invalid ranges fail with invalid_input/400. Other methods or extra path segments are not endpoints.

**Output:** 200 JSON `{revision:number,offset:number,total:number,nextOffset:number|null,entries:[{messageId:string,message:Pi.Message,metadata:JsonObject}]}` with `Cache-Control: no-store`. Entries remain in context order and contain complete persisted content, including native images and opaque thinking signatures in member context. Group context begins with a Team-owned user-role summary entry when one exists, followed by unchanged original tail entries. Group context revision is independent of the publication cursor and changes on summary replacement as well as append/reset. API adds no total token estimate, model system/tool prompt, transient partial or stable-history projection; Team supplies any summary entry as part of its effective context. Pagination bounds entry count, not encoded bytes; one multimodal entry can be large.

**Effect/failure:** Read-only calls into Team scope/group ports and Agent inspection; API owns no SQL. Missing workspace/member, retired member or wrong workspace returns not_found/404. Appends/replacements/reset between pages return context_changed/409 using the usual `{error:{code,message}}` envelope. Refresh from offset 0 without revision after a conflict. The page header and entries share an owner repeatable-read snapshot. Reads do not require runtime ownership or change the running Agent/group context. No frontend files or existing stream/timeline contracts change.

**Usage example:** `GET /workspaces/w/members/m/context?limit=50` then, for revision 8 and nextOffset 50, `GET /workspaces/w/members/m/context?offset=50&limit=50&revision=8`. Use the same query rules on `/workspaces/w/chat/context`. Group and member revisions are independent and must not be interchanged.


## Canonical route inventory

The server factory does not bind a socket. Runtime owns listening/shutdown and supplies initialized owner services. The HTTP layer adds no general authentication, CORS or API-prefix routing. Browser hosts proxy these resource paths; Desktop maps its own API base onto them.

| Resource | Supported methods and interactions |
| --- | --- |
| `/agents` | GET solo list; POST `{agentId?}` to create (201), subject to app creation policy |
| `/agents/:id/config` | GET; POST `{value}`; PUT `{revision,value}`; DELETE `{revision}` |
| `/agents/:id/state` | GET current state |
| `/agents/:id/runs` | POST `{input}` native Pi user content; returns 202 with run id, run and follow URL |
| `/agents/:id/runs/:runId/cancel` | POST cancellation request (202) |
| `/agents/:id/follow` | GET SSE; optional `runId`, `after` history cursor |
| `/config/capabilities`, `/config/app` | GET capabilities/app; PUT app `{revision,value}` |
| `/config/connections`, `/config/catalog` | GET list; POST `{id,value}`; GET/PUT/DELETE `/:id`, with revision-checked updates/deletes |
| `/config/connections/:id/models` | GET choices; POST `/refresh` with `{}` performs provider discovery |
| `/workspaces` | GET `{workspaces}`; POST registration `{workspaceId?,name,directory,adopt,models,cleanupRevision?}` (201) |
| `/workspaces/initialization` | POST `{directory,adopt}` read-only cleanup review |
| `/workspaces/:id`, `/workspaces/:id/models` | GET metadata/models; PUT models `{revision,value}` |
| `/workspaces/:id/members` | GET lightweight active roster; `/:memberId` GET metadata |
| `/workspaces/:id/members/:memberId/model-settings` | GET; PUT `{revision,value}` user model preferences |
| `/workspaces/:id/members/:memberId/context` | GET read-only retained Agent context |
| `/workspaces/:id/team/configuration/activate` | POST `{}` validates/activates all current member files, requiring idle workspace |
| `/workspaces/:id/chat` | GET shared snapshot (`after`, `limit`); PUT `{mentionLimit}` |
| `/workspaces/:id/chat/messages` | POST `{text}` JSON or multipart text/images; returns 202 acceptance |
| `/workspaces/:id/chat/history` | GET bounded display history (`limit`, optional `before` plus `resetCursor`) |
| `/workspaces/:id/chat/timeline` | GET incremental presentation changes (`after`, `limit`) |
| `/workspaces/:id/chat/follow`, `/timeline-follow` | GET SSE; `after` resumes the appropriate feed |
| `/workspaces/:id/chat/attachments/:imageId` | GET original image bytes with MIME type, length and private/no-cache headers |
| `/workspaces/:id/chat/summary`, `/context` | GET saved summary/effective group context |
| `/workspaces/:id/chat/stop`, `/reset` | POST explicit stop (202) or idle conversation reset (200) |

In the final rows, `/timeline-follow`, `/context` and `/reset` are suffixes under the same `/workspaces/:id/chat` resource. Team stop requests cancellation without erasing history; reset preserves project files and member configuration. Administrative full-workspace data reset is not an endpoint.

The former `/workspaces/:id/team`, `/team/roster`, `/team/chat/...` and `/team/members/...` forms return 404. Activation retains the explicit `/team/configuration/activate` route. There are no HTTP design-file, general project-file, Git-baseline or semantic-index routes in current workspace routing. Do not derive endpoints from DESIGN inventories or source comments.

## Bodies, streams and error recovery

JSON body readers require `application/json` and a JSON object, reject unknown fields where `fields()` is applied, and impose byte limits. The default is 2 MiB; Team JSON is 1 MiB, workspace JSON 4 MiB, and solo-run input uses app `maxInputBytes`. Workspace/team query validators reject unknown and duplicate keys. Multipart image transport/limits are implemented in `chat-images.ts`; Core validates image semantics and recipient capabilities before publication. Solo user images use the native content representation, not that multipart endpoint.

Before headers, application errors return `{error:{code,message}}` with the Core status; unexpected failures log their cause and return 503 `backend_error` with a short message. Invalid JSON/media shape and limits produce explicit 4xx errors. Unsupported methods/extra segments are generally 404. Mutating Core work or files may already have committed before a later response failure; HTTP failure is not an automatic rollback/retry signal.

SSE reads its first generator item before sending headers, preserving initial validation errors as HTTP statuses. It emits `event: <type>` plus JSON `data`, observes socket backpressure, and sends 15-second comment keepalives only when writable. Later generator errors produce `stream_error` with reconnect guidance and end the stream. Disconnect aborts subscription iteration and releases the generator; it does not cancel independent runs. Reconcile stable records from the last applied cursor after reconnect.

History defaults to the latest 50 entries (1–100). Older pages require the response's `nextBefore` with its `resetCursor`; this display position differs from the incremental timeline cursor. Reset-generation conflicts require a fresh latest snapshot. Timeline/snapshot limits are 1–500. Context pagination described above is a different revision-pinned protocol.

```text
GET /workspaces/w/chat/history?limit=50
GET /workspaces/w/chat/history?before=20&resetCursor=3&limit=50
GET /workspaces/w/chat/timeline-follow?after=104
POST /workspaces/w/chat/messages  Content-Type: application/json
{"text":"Review the current usage contract."}
```

Use cursor values returned for that actual workspace rather than the illustrative numbers. Initialization cleanup consent and current-file activation are explicit user operations; reads do not trigger them. Supporting include files supplement this contract and are opened on demand. The earlier stale `/team/chat` and `/team/members` examples were corrected during this context review; implementation and DESIGN were not changed.
