# API usage contract

**Input:** `createAgentServer(runtime, config, workspaces, team)`; HTTP JSON or multipart bodies, paths/query revisions and cursors.

**Output:** An unbound HTTP server; JSON/error envelopes, image responses and SSE frames. Existing route names, payloads, cursor ordering and final-reference semantics are unchanged.

**Effect and failure:** Transport consumes sockets and stream subscriptions; semantic decisions and persistence remain Core-owned. Disconnects release follow resources without pretending to cancel independent runs.

**Usage example:** `const server = createAgentServer(runtime, config, workspaces, team); server.listen(port, host);` For browser use, `GET /agents` lists solo agents. `GET /workspaces/:id/team/chat/timeline?after=0&limit=100` returns ordered timeline changes; follow using its change cursor.

## Context inspection

**Group summary:** `GET /workspaces/:workspaceId/team/chat/summary` accepts no query parameters and returns 200 `{summary:GroupSummary|null,retainedMessages:30}` with `Cache-Control:no-store`. The saved summary includes revision, from, through (summarized prefix end), analyzedThrough (pinned snapshot end), sourceDigest, text, messageId and time. Team checks workspace scope before reading; missing workspace is 404, unknown queries are 400, writes/extra segments are 404. Reads never start generation. The old semantic-index endpoint returns 404.

**Input:**

- `GET /workspaces/:workspaceId/team/members/:memberId/context`: current durable context of an active member in this workspace.
- `GET /workspaces/:workspaceId/team/chat/context`: current effective shared group context (accepted summary plus original tail).

Both accept only optional `offset`, `limit`, `revision` query parameters as nonnegative decimal integers. Offset defaults to 0, limit to 50 (allowed 1–100). A request with offset greater than 0 must include the revision returned by the first page. Unknown/repeated parameters and invalid ranges fail with invalid_input/400. Other methods or extra path segments are not endpoints.

**Output:** 200 JSON `{revision:number,offset:number,total:number,nextOffset:number|null,entries:[{messageId:string,message:Pi.Message,metadata:JsonObject}]}` with `Cache-Control: no-store`. Entries remain in context order and contain complete persisted content, including native images and opaque thinking signatures in member context. Group context begins with a Team-owned user-role summary entry when one exists, followed by unchanged original tail entries. Group context revision is independent of the publication cursor and changes on summary replacement as well as append/reset. No total token estimate, model system/tool prompt, transient partial, stable history or synthetic entry is added. Pagination bounds entry count, not encoded bytes; one multimodal entry can be large.

**Effect/failure:** Read-only calls into Team scope/group ports and Agent inspection; API owns no SQL. Missing workspace/member, retired member or wrong workspace returns not_found/404. Appends/replacements/reset between pages return context_changed/409 using the usual `{error:{code,message}}` envelope. Refresh from offset 0 without revision after a conflict. The page header and entries share an owner repeatable-read snapshot. Reads do not require runtime ownership or change the running Agent/group context. No frontend files or existing stream/timeline contracts change.

**Usage example:** `GET /workspaces/w/team/members/m/context?limit=50` then, for revision 8 and nextOffset 50, `GET /workspaces/w/team/members/m/context?offset=50&limit=50&revision=8`. Use the same query rules on `/workspaces/w/team/chat/context`. Group and member revisions are independent and must not be interchanged.
