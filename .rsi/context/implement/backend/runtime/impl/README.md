# Runtime implementation context

After `runtime.open()` and successful HTTP listen, the host calls `void team.startMaintenance()` to check retained group contexts without blocking startup on model generation. Both startup failure cleanup and normal shutdown await `team.closeMaintenance()` before closing the runtime/storage, so background shared-summary generation is cancelled and drained safely.

## Result summary

`backend/src/runtime/main.ts` is the process composition root. The model/tool execution loop is Core AgentExecution, hosted durably by AgentRuntime with AgentData, not this hosting system.

Design: [Runtime](../../../../design/backend/runtime/design.md).

### Coordination and ownership

Read child-process settings; construct MySqlStorage and CoreData; construct Core services, policies and API; initialize Core schema/config/team; acquire runtime ownership/recover abandoned runs; bind HTTP. Signals close HTTP admission/runs, persistent shells, workspace resources and the Core persistence/Storage lifetime.

### Implemented contract

**Input:** `DATABASE_URL`, `CONFIG_ENCRYPTION_KEY`, `HOST`, `PORT`, optional `DEEPSEEK_WEB_API_KEY`, `RSI_HARNESS_PERMISSIONS_ENABLED`, `RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS`, provided by managed Operations launchers.

**Output:** A listening backend and startup log, or an explicit startup error. SIGINT/SIGTERM closes owned resources. Missing DATABASE_URL fails before any database access.

**Effect and failure:** No business schema or SQL belongs here. Hosting constructs one dedicated resource graph; failed startup closes the initialized graph. Durable messages survive restart; transient progress does not.

**Usage example:** Operations starts source with `node --import tsx backend/src/runtime/main.ts` or compiled `backend/dist/src/runtime/main.js` in a configured child environment. Normal users use the managed scripts, which load private project settings.

### Compaction configuration

main.ts resolves Number(RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS ?? 64000) and agentPrompt('context-compaction'), then passes {compaction:{thresholdTokens,prompt}} to AgentRuntime. Invalid thresholds or missing prompt assets fail startup explicitly. The same threshold covers both checkpoints. Agent owns estimation/triggers and durable hosting; no token policy is implemented here.

## File lookup

- [backend/src/runtime](../../../../../../backend/src/runtime): owned implementation.
- [Backend tests](../../../../../../backend/test): deterministic/unit/HTTP and disposable MySQL verification.

## Automatic retrieval

```json
{"commands": []}
```

### React Harness hosting

Runtime constructs Team without a permission-mode argument and wires Agent's File/Default React Harness assembly through Team policy. Web executors, Bash runtime cleanup and compaction prompt loading are Agent-owned imports. No sandbox initialization, Git approval service or RSI_HARNESS_PERMISSIONS_ENABLED setting is used. Required Agent, Team and Workspace prompt assets are copied into dist by `copy-prompts.mjs`. Missing assets still fail explicitly. Shutdown drains work and closes Bash resources without requiring Workspace enumeration.
