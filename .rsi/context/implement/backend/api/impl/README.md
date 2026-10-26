# API implementation context

## Result summary

HTTP routing, error translation, SSE/backpressure and multipart parsing live in `backend/src/api`. Request image parsing was separated from Core image preparation.

Design: [API](../../../../design/backend/api/design.md).

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

**Input:**

- `GET /workspaces/:workspaceId/team/members/:memberId/context`: current durable context of an active member in this workspace.
- `GET /workspaces/:workspaceId/team/chat/context`: current original shared group context.

Both accept only optional `offset`, `limit`, `revision` query parameters as nonnegative decimal integers. Offset defaults to 0, limit to 50 (allowed 1–100). A request with offset greater than 0 must include the revision returned by the first page. Unknown/repeated parameters and invalid ranges fail with invalid_input/400. Other methods or extra path segments are not endpoints.

**Output:** 200 JSON `{revision:number,offset:number,total:number,nextOffset:number|null,entries:[{messageId:string,message:Pi.Message,metadata:JsonObject}]}` with `Cache-Control: no-store`. Entries remain in context order and contain complete persisted content, including native images and opaque thinking signatures. No total token estimate, model system/tool prompt, transient partial, stable history or synthetic entry is added. Pagination bounds entry count, not encoded bytes; one multimodal entry can be large.

**Effect/failure:** Read-only calls into Team scope/group ports and Agent inspection; API owns no SQL. Missing workspace/member, retired member or wrong workspace returns not_found/404. Appends/replacements/reset between pages return context_changed/409 using the usual `{error:{code,message}}` envelope. Refresh from offset 0 without revision after a conflict. The page header and entries share an owner repeatable-read snapshot. Reads do not require runtime ownership or change the running Agent/group context. No frontend files or existing stream/timeline contracts change.

**Usage example:** `GET /workspaces/w/team/members/m/context?limit=50` then, for revision 8 and nextOffset 50, `GET /workspaces/w/team/members/m/context?offset=50&limit=50&revision=8`. Use the same query rules on `/workspaces/w/team/chat/context`. Group and member revisions are independent and must not be interchanged.

## File lookup

- [backend/src/api](../../../../../../backend/src/api): owned implementation.
- [Backend tests](../../../../../../backend/test): deterministic/unit/HTTP and disposable MySQL verification.

## Automatic retrieval

```json
{"commands": []}
```
