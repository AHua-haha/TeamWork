## Result summary

Runtime context rebuilt from accepted design and `main.ts`. Runtime is a top-level executable composition root: it reads environment settings, creates concrete services/store, wires team/runtime/web tools, runs startup initialization, binds HTTP, and performs shutdown cleanup. No project source was changed. Actual behavior differs from older design text: encryption variable is `CONFIG_ENCRYPTION_KEY` (not `ENCRYPTION_KEY`); `HOST` is configurable with loopback default; startup runs config/team/runtime initialization but has no explicit `acquireOwnership()` call in this file (runtime.open owns runtime lifecycle). Startup does not register migrations under direct database lock calls as described in the prior design prose; inspect delegated methods before asserting exact sequencing.

## File lookup

| Path | Description |
|---|---|
| `backend/src/runtime/main.ts` | Process startup, service composition, listen and shutdown. |
| `backend/src/storage/database.ts` | Concrete store construction and migrations/lifecycle methods (Storage context). |
| `backend/src/api/http.ts` | Server constructor passed to runtime. |
| `.rsi/context/design/backend/runtime/design.md` | Accepted Runtime lifecycle contract. |

## Implemented contract

### Process entry point

There is no exported runtime function: importing/executing `main.ts` starts the process. Required environment: `DATABASE_URL`; optional `CONFIG_ENCRYPTION_KEY`, `DEEPSEEK_WEB_API_KEY`, `PORT` (default `3000`), `HOST` (default `127.0.0.1`). `PORT` must be integer 0–65535. `createBackendModels()` constructs provider models. The root constructs `MySqlStore`, `ConfigService`, `WorkspaceService`, `TeamSystem`, `AgentRuntime`, attaches runtime to team, and constructs the HTTP server.

Startup awaits `store.migrate()`, `config.initialize()`, `team.initialize()`, `runtime.open()`, then listens. On startup failure it closes team runner, runtime (best-effort), Bash runtime, workspace service and store, then rethrows. On SIGINT/SIGTERM, guarded shutdown closes team runner/runtime, HTTP server/connections, Bash runtime, workspace service and store; errors set process exit code 1. Observable effects: database connections/init, server socket bind, logs, signal handlers and background runtime lifecycle. Example: configure `DATABASE_URL=mysql://...` and run the backend entry point; it listens at configured host/port.

## Implementation notes

This file deliberately imports every concrete layer/service and is the composition root. `team.attach(runtime)` completes circular collaboration after construction. Web tools receive the optional DeepSeek web API key; Bash runtime has a dedicated close hook. Ownership/migration details are delegated to MySqlStore/AgentRuntime lifecycle and must be verified there, not inferred from main.

## Verification and continuation

Inspected current `main.ts` and accepted Runtime design; no tests run and no source code changed. Known design/code discrepancies are recorded above. Inspect `MySqlStore.migrate`, `AgentRuntime.open/close`, `TeamSystem.initialize`, and startup error behavior to close lifecycle detail gaps. This context documents actual startup sequence, not a claim that startup was executed.

## Automatic retrieval

```json
{"commands": []}
```
