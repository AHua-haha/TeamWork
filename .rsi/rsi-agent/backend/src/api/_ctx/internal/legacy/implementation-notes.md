# API implementation context

## Result summary

HTTP routing, error translation, SSE/backpressure and multipart parsing live in `backend/src/api`. Request image parsing was separated from Core image preparation.

Design: [API](../../DESIGN.md).

### Coordination and ownership

createAgentServer receives AgentRuntime and configuration/workspace/team services and returns an unbound Node HTTP server. HTTP handlers call Core operations, map errors and stream Core history/progress. readImageSubmission parses multipart requests; Core prepares/validates image blocks.

### Implemented contract

**Input:** `createAgentServer(runtime, config, workspaces, team)`; HTTP JSON or multipart bodies, paths/query revisions and cursors.

**Output:** An unbound HTTP server; JSON/error envelopes, image responses and SSE frames. Existing route names, payloads, cursor ordering and final-reference semantics are unchanged.

**Effect and failure:** Transport consumes sockets and stream subscriptions; semantic decisions and persistence remain Core-owned. Disconnects release follow resources without pretending to cancel independent runs.

**Usage example:** `const server = createAgentServer(runtime, config, workspaces, team); server.listen(port, host);` For browser use, `GET /agents` lists solo agents. `GET /workspaces/:id/team/chat/timeline?after=0&limit=100` returns ordered timeline changes; follow using its change cursor.

### Context-preserving workspace initialization

**Input:** POST /workspaces/initialization JSON {directory,adopt}; POST /workspaces JSON {workspaceId?,name,directory,adopt,models,cleanupRevision?}. Both reject unknown fields/query parameters.

**Output:** Inspection 200 {directory,cleanupPaths,cleanupRevision:string|null}; creation 201 Workspace. Nonempty state without matching cleanupRevision returns cleanup_required/409. Invalid revision format returns invalid_input/400; unsafe managed/context paths return file_exists/409; existing registry overlaps return workspace_exists/409.

**Effect and failure:** Inspection is read-only; creation delegates revision-bound cleanup/context preservation to Workspace. Existing context and source files are excluded from cleanup. Error envelopes retain the existing {error:{code,message}} shape.

**Usage example:** inspect an existing directory, display cleanupPaths, then POST /workspaces with its cleanupRevision only after explicit user confirmation. If state changes, inspect/review again before retrying.

### Read-only context APIs

**Group summary:** `GET /workspaces/:workspaceId/team/chat/summary` accepts no query parameters and returns 200 `{summary:GroupSummary|null,retainedMessages:30}` with `Cache-Control:no-store`. The saved summary includes revision, from, through (summarized prefix end), analyzedThrough (pinned snapshot end), sourceDigest, text, messageId and time. Team checks workspace scope before reading; missing workspace is 404, unknown queries are 400, writes/extra segments are 404. Reads never start generation. The old semantic-index endpoint returns 404.

**Input:**

- `GET /workspaces/:workspaceId/team/members/:memberId/context`: current durable context of an active member in this workspace.
- `GET /workspaces/:workspaceId/team/chat/context`: current effective shared group context (accepted summary plus original tail).

Both accept only optional `offset`, `limit`, `revision` query parameters as nonnegative decimal integers. Offset defaults to 0, limit to 50 (allowed 1–100). A request with offset greater than 0 must include the revision returned by the first page. Unknown/repeated parameters and invalid ranges fail with invalid_input/400. Other methods or extra path segments are not endpoints.

**Output:** 200 JSON `{revision:number,offset:number,total:number,nextOffset:number|null,entries:[{messageId:string,message:Pi.Message,metadata:JsonObject}]}` with `Cache-Control: no-store`. Entries remain in context order and contain complete persisted content, including native images and opaque thinking signatures in member context. Group context begins with a Team-owned user-role summary entry when one exists, followed by unchanged original tail entries. Group context revision is independent of the publication cursor and changes on summary replacement as well as append/reset. No total token estimate, model system/tool prompt, transient partial, stable history or synthetic entry is added. Pagination bounds entry count, not encoded bytes; one multimodal entry can be large.

**Effect/failure:** Read-only calls into Team scope/group ports and Agent inspection; API owns no SQL. Missing workspace/member, retired member or wrong workspace returns not_found/404. Appends/replacements/reset between pages return context_changed/409 using the usual `{error:{code,message}}` envelope. Refresh from offset 0 without revision after a conflict. The page header and entries share an owner repeatable-read snapshot. Reads do not require runtime ownership or change the running Agent/group context. No frontend files or existing stream/timeline contracts change.

**Usage example:** `GET /workspaces/w/team/members/m/context?limit=50` then, for revision 8 and nextOffset 50, `GET /workspaces/w/team/members/m/context?offset=50&limit=50&revision=8`. Use the same query rules on `/workspaces/w/team/chat/context`. Group and member revisions are independent and must not be interchanged.

## File lookup

- [backend/src/api](../../../../../../../../backend/src/api): owned implementation.
- [Backend tests](../../../../../../../../backend/test): deterministic/unit/HTTP and disposable MySQL verification.

## Automatic retrieval

```json
{"commands": []}
```

## Roster endpoint

**Input:** `GET /workspaces/:workspaceId/team/roster` without query parameters or body.

**Output:** 200 `{workspaceId,members:[{memberId,workspaceId,revision,name,role,responsibility,lead,running}]}` for accepted active members, lead first. No readiness/effective harness/model fields.

**Effect/failure:** delegates to TeamSystem.roster with no design/harness inspection or writes. Unknown workspaces return not_found/404; unknown/repeated query parameters return invalid_input/400; extra segments and write methods are not endpoints.

**Usage:** ordinary chat calls roster; deliberate detailed inspection can still call the existing GET team API. Committed configuration review and activate endpoints retain existing validation and revision/digest semantics.

### Bounded group-history HTTP contract

**Input:** `GET /workspaces/:id/chat/history?limit=50` (legacy `/team/chat/history` alias is also available). Older pages: `?before=<nextBefore>&limit=50&resetCursor=<resetCursor>`. Accept only these three nonnegative integer query parameters; Core requires positive before and limit 1–100.

**Output:** 200 `{workspaceId,cursor,resetCursor,entries,nextBefore,hasOlder}`, `Cache-Control:no-store`. Current public entries are ascending by display position. Snapshot cursor and reset generation are consistent with the returned values. Working messages are not embedded; their existing Agent follow resource remains separate.

**Effect:** read-only Team delegation, no SQL in API. Unknown/repeated parameters are 400; missing workspace is 404; reset-generation mismatch is `history_reset`/409. Refresh/reconnect use the existing `/workspaces/:id/chat/timeline-follow?after=<last-applied-change>` endpoint, rather than fetching history again. Existing backend `invalid_cursor` errors and reset events permit bounded resnapshot recovery; no change records are pruned by this feature.

**Usage:** fetch the initial history page; then follow from its cursor. Use nextBefore only for explicit older-page reads. Do not use a display position as a live-update cursor.
