# Operations — implementation context

## Result summary

The Operations scripts now use the root `operations.config.json` as their sole tunable-settings input. First use creates the file privately (`0600`) with independent generated development/deployment credentials and encryption keys. The checked-in `operations.config.example.json` documents the full schema, including the database root password field; replace placeholder secrets locally and copy the template to the root config before use. Child app processes get an explicitly assembled environment, not inherited config/port variables. Runtime paths and generated Compose configuration derive from config. Operations does not use `backend/compose.yaml`.

The dedicated MySQL service is generated with a checkout-specific Compose project and persistent volume. Development/deployment databases and accounts are separate; provisioning only creates/alters/grants and never drops or truncates. App stop leaves MySQL running. Deployment success/status reports frontend and backend URLs. Lifecycle tests now exercise config-only behavior, foreign-port refusal, source export/build and failure preservation/rebuild.

**This checkout's private config instance:** `operations.config.json` now exists with mode `0600`. Its MySQL port is `4211`, matching the previously inspected checkout-owned service; the other service `backend-mysql-1` remains on port `3306`. The root password is set to the existing checkout service credential (`local-root`) to preserve access to its existing volume; changing it would prevent MySQL authentication against that persisted data. Development/deployment DB account passwords and encryption keys are newly generated and separate. The old checkout container remains exited; it was not started or otherwise changed. Do not treat this config as a fresh empty database instance until the volume contents and access are verified safely.


## File lookup

| Path | Description |
|---|---|
| `.rsi/context/design/operations/design.md` | Accepted Operations contract: root config only, non-interference, isolated DB service and data preservation. |
| `operations.config.example.json` | Full non-secret config template, including `database.rootPassword`. |
| `.gitignore` | Excludes local root config and `.operations/` runtime state. |
| `scripts/host-common.mjs` | Config bootstrap/validation, path and service-setting derivation, generated Compose file, locking, process identity and readiness. |
| `scripts/develop.mjs` | Development start/stop/status/log lifecycle and configured child environment. |
| `scripts/deployment.mjs` | Committed-ref build/deploy, URL output, recovery and configured runtime paths. |
| `scripts/database.mjs` | Dedicated Compose service and non-destructive DB/account provisioning. |
| `scripts/dev.sh`, `scripts/deploy.sh`, `scripts/database.sh` | Operator entrypoints. |
| `scripts/serve-frontend.mjs` | Static host and streaming API/upload/SSE proxy. |
| `scripts/test/deployment.test.mjs` | Config-only lifecycle and deployment regression tests. |
| `scripts/test/frontend-host.test.mjs` | Static host, streaming, upload, SSE cancellation and path safety tests. |
| `backend/compose.yaml` | Legacy service; must not be managed by Operations. |

## Automatic retrieval

```json
{"commands": []}
```

## Implemented contract

### Configuration

**Input:** `loadConfig({create=true})` reads only `<checkout>/operations.config.json`. It uses `stateDirectory`, `deployRoot`, `database: {port, rootPassword}`, and `development`/`deployment` objects containing app ports, fixed isolated database names, account credentials, 32-byte base64 encryption keys and optional provider key.

**Output:** Parsed validated settings, or a non-secret error. On first use, exclusive creation writes generated secrets with mode `0600`. `runtimePaths()` derives local state, deployment and Compose paths. `serviceSettings(kind)` forms the app database URL/settings.

**Effect:** No dotenv or environment configuration is read or written. Environment variables such as `DATABASE_URL`, `PORT` and prior RSI overrides do not configure applications. Child app env is explicitly constructed. Config and runtime state are excluded from Git.

**Usage:** Copy `operations.config.example.json` to `operations.config.json`, replace secret placeholders with local secrets, then run `./scripts/dev.sh init` and/or `./scripts/deploy.sh init`.

### Lifecycle CLIs

**Input:** `./scripts/dev.sh {init|start|stop|restart|status|logs [backend|frontend]}`, `./scripts/deploy.sh {init|deploy <local-git-ref>|update [local-git-ref]|start|stop|restart|status|logs [backend|frontend]}`, and `./scripts/database.sh {start|stop|status}`.

**Output:** Failures are nonzero. Successful deploy and status display frontend/backend URLs. Port conflicts fail without signaling the port owner. Status is read-only. Logs do not need DB connectivity.

**Effect:** Apps bind loopback; dev/deploy use separate DBs and encryption keys on this checkout's isolated MySQL service. DB provisioning uses non-destructive `CREATE IF NOT EXISTS`, `ALTER USER`, and `GRANT`. App stop doesn't stop the database. Explicit database stop targets the checkout Compose project and preserves its volume. Deployment builds a locally committed archive before stopping the active app, then attempts previous-release recovery on launch failure.

**Usage:** `./scripts/dev.sh start`; `./scripts/deploy.sh deploy HEAD`; `./scripts/database.sh status`.

## Implementation notes

- Tool subprocesses use PATH from the invoking process (or a conventional fallback) and HOME set to checkout root. These execution mechanics are not Operations configuration inputs; tunable app/service settings remain explicit.
- Root password is stored in private generated Compose YAML and not passed as a command-line argument. Provisioning SQL is sent via stdin.
- Checkout identity is SHA-256 of the absolute checkout path. Moving the checkout yields a new Compose identity rather than silently reusing the old volume.
- The existing checkout service uses the same checkout-derived Compose project and named volume. Its prior root credential (`local-root`) and host port (`4211`) are preserved in the private config. The generated config path is now under `.operations/`; the old state file remains untouched. Do not delete or reset the existing volume.

## Verification and continuation

Passed: JavaScript syntax checks for Operations modules/tests; `git diff --check`; `node --test scripts/test/deployment.test.mjs` (4/4); `node --test scripts/test/frontend-host.test.mjs` (1/1). Tests verify config permissions and precedence, that an inherited sentinel is not leaked into the backend, deployment URL reporting, build failure preserving active process, rebuild after temporary source removal, and foreign-port refusal.

Docker inspection succeeded and confirmed the exact project container/volume identities above. The `backend-mysql-1` container was not changed. The checkout container remains exited. Its existing named volume was not altered, and the private config preserves its known root credential and host port. I did not start or provision the service, so startup/authentication, database contents, both DB provisions, persistence and legacy-service non-interference during active DB operations remain open for a safe, data-preserving Docker test. Never run `docker compose down -v` or delete the named volume.

## Changes in this continuation

- `scripts/host-common.mjs` (child PATH derives from available host PATH rather than a fixed platform path)
- `operations.config.example.json` (required root password field)
- `scripts/test/deployment.test.mjs` (replaced obsolete env-file/override assertions with config-only fixture tests)
- `.rsi/context/implement/operations/impl/README.md` (this implementation context)

Pre-existing pending changes to Operations source and `.gitignore` remain. The unrelated `.rsi/context/implement/impl/README.md` modification was left untouched. No commit was made and no database data was reset.
