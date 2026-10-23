<!-- Task implementation; promoted with verified code. -->
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

## File lookup

- [backend/src/api](../../../../../../backend/src/api): owned implementation.
- [Backend tests](../../../../../../backend/test): deterministic/unit/HTTP and disposable MySQL verification.

## Automatic retrieval

```json
{"commands": []}
```
