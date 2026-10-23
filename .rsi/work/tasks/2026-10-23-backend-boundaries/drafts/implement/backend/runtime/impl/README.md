<!-- Task implementation; promoted with verified code. -->
# Runtime implementation context

## Result summary

`backend/src/runtime/main.ts` is the process composition root. The model/tool execution loop is Core AgentRuntime, not this hosting system.

Design: [Runtime](../../../../design/backend/runtime/design.md).

### Coordination and ownership

Read child-process settings; construct MySqlStorage and CoreData; construct Core services, policies and API; initialize Core schema/config/team; acquire runtime ownership/recover abandoned runs; bind HTTP. Signals close HTTP admission/runs, persistent shells, workspace resources and the Core persistence/Storage lifetime.

### Implemented contract

**Input:** `DATABASE_URL`, `CONFIG_ENCRYPTION_KEY`, `HOST`, `PORT`, optional `DEEPSEEK_WEB_API_KEY`, `RSI_HARNESS_PERMISSIONS_ENABLED`, provided by managed Operations launchers.

**Output:** A listening backend and startup log, or an explicit startup error. SIGINT/SIGTERM closes owned resources. Missing DATABASE_URL fails before any database access.

**Effect and failure:** No business schema or SQL belongs here. Hosting constructs one dedicated resource graph; failed startup closes the initialized graph. Durable messages survive restart; transient progress does not.

**Usage example:** Operations starts source with `node --import tsx backend/src/runtime/main.ts` or compiled `backend/dist/src/runtime/main.js` in a configured child environment. Normal users use the managed scripts, which load private project settings.

## File lookup

- [backend/src/runtime](../../../../../../backend/src/runtime): owned implementation.
- [Backend tests](../../../../../../backend/test): deterministic/unit/HTTP and disposable MySQL verification.

## Automatic retrieval

```json
{"commands": []}
```
