---
summary: Starts the backend process by wiring Storage, owner repositories, services and HTTP, and coordinates signal-driven shutdown.
include:
  - backend/src/runtime/main.ts
  - backend/src/core/agent/prompts.ts
  - scripts/backend-command.mjs
  - scripts/host-config.mjs
  - backend/package.json
---

# Runtime usage contract

`backend/src/runtime/main.ts` is a process entry module with immediate effects on import, not a reusable server object. Operations normally launches it through package commands and supplies child environment from the selected environment of private `rsi.config.json`.

## Inputs and startup

- `DATABASE_URL` is required and names a MySQL database. `CONFIG_ENCRYPTION_KEY` is passed to ConfigService for encrypted credentials.
- `HOST` defaults to `127.0.0.1`; `PORT` defaults to `3000`, accepting integers 0–65535. With port 0 the OS selects a port, but the startup log prints the configured value.
- `RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS` is converted to a number with a direct-entry fallback of 64000. Operations validates an explicit per-environment positive safe integer. Agent owns threshold validation/trigger policy.
- `DEEPSEEK_WEB_API_KEY` configures optional web tools. Other intentional provider/proxy settings are Operations-managed child inputs. The retired harness switch is not a permission mode.

Startup constructs models, Storage, CoreData, ConfigService, WorkspaceService, TeamSystem, AgentRuntime and HTTP. It injects the file-maintained Agent compaction prompt/threshold and attaches Team, then migrates schemas, initializes configuration/leads, opens Agent runtime ownership and listens. Team maintenance is scheduled asynchronously after listening. Abandoned tool effects are not replayed.

```sh
npm --prefix backend run build
npm --prefix backend start
```

These commands start the configured development backend after locked dependencies are installed; they do not switch deployment. Use `./scripts/dev.sh start` for the browser development environment. Operations owns deployment/Desktop selection. Building does not launch a process.

## Outputs, shutdown and failures

Successful binding logs `Agent backend listening on <host>:<configured-port>` and exposes the [API](../../api/_ctx/README.md). Persistent records, project files and tools retain their owner-specific effects.

SIGINT/SIGTERM enter a guarded shutdown once: stop HTTP admission, close/drain Team maintenance and runner, close Agent runtime, force-close remaining HTTP connections, await server closure, then close Bash runtimes, Workspace managers and Core/Storage. Errors are logged and set a failing exit code. Shutdown is cooperative, without a Runtime watchdog deadline.

Failures inside migration/initialization/listening attempt service/shell/storage cleanup before rethrowing. Construction and missing-environment errors happen before that guard. Cleanup is sequential: one cleanup error can prevent later cleanup or replace the original failure. There is no all-resources guarantee for every possible startup failure. Completed migrations or external effects are not rolled back by process failure.

Runtime adds no request authentication, business SQL, context watcher, token estimator or permission enforcement. Operations owns processes; Core owns execution/business recovery. Included files supplement this README and must be opened explicitly.
