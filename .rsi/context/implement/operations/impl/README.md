# Operations — implementation context

## Result summary

Operations implementation context has been consolidated to the accepted single Operations design after commit `f1fcf28` (`Consolidate operations design`). The parent design now owns development lifecycle, host deployment, and checkout-isolated MySQL lifecycle; former child design nodes have been removed. Source code was not modified by this documentation consolidation. Existing scripts implement development/deployment lifecycle and still use the legacy `backend/compose.yaml` service as described in existing child contexts; this does **not** yet satisfy the newly accepted design's requirement for a distinct Compose configuration/project and persistent volume for this checkout. Implementation work remains open. No project tests were run.

## File lookup

| Path | Description |
|---|---|
| `.rsi/context/design/operations/design.md` | Accepted single Operations design: lifecycle, dedicated service, safety and acceptance requirements. |
| `.rsi/context/design/operations/metadata.json` | Implementation mapping for the entire Operations system. |
| `scripts/host-common.mjs` | Shared state/env validation, process identity, lifecycle lock, logging/readiness. |
| `scripts/dev.sh`, `scripts/develop.mjs` | Development CLI and backend/Vite lifecycle. |
| `scripts/deploy.sh`, `scripts/deployment.mjs` | Release build/selection and deployment lifecycle/recovery. |
| `scripts/serve-frontend.mjs` | Built asset server and streaming backend proxy. |
| `scripts/database.sh`, `scripts/database.mjs` | MySQL lifecycle and development provisioning; currently needs migration to checkout-specific Compose service. |
| `backend/compose.yaml` | Legacy service configuration; must remain unaffected by dedicated service implementation. |
| `scripts/test` | Operations lifecycle test suite; tests not run. |
| `.rsi/context/implement/operations/{local-dev,host-deployment,shared-database}/impl/README.md` | Prior child-scope inspection notes retained for reference; not separate design assignments now. |

## Automatic retrieval

```json
{"commands": []}
```

## Implemented contract

**Inputs:** `scripts/dev.sh` accepts `init`, `start`, `stop`, `restart`, `status`, and `logs [backend|frontend]`. `scripts/deploy.sh` accepts those lifecycle commands plus `deploy <git-ref>` and `update [git-ref]`. `scripts/database.sh` accepts `start`, `stop`, and `status`. Deployment may use `RSI_STATE_DIR`, `XDG_STATE_HOME`, `RSI_DEPLOY_ROOT`, `RSI_DEPLOY_BACKEND_PORT`, and `RSI_DEPLOY_FRONTEND_PORT` as applicable.

**Outputs:** CLIs report status/readiness/logs or fail with nonzero exit status and an error message. Existing process management checks process identity before signaling; lifecycle mutation locks prevent concurrent operations.

**Effects:** Development starts backend/Vite; deployment builds a committed Git revision into a temporary release, runs backend plus static/proxy frontend, and stores state/logs outside that release. Currently database lifecycle uses the legacy Compose service, so the accepted isolated-service behavior is not implemented. No code in this system should reset/copy data or mutate the other branch's legacy service. Exact database and encryption configuration is read from environment files managed by lifecycle scripts.

**Usage:** `scripts/dev.sh start`; `scripts/deploy.sh deploy HEAD`; `scripts/deploy.sh update`; `scripts/database.sh status`.

## Implementation notes

Existing implementation context from the former local-dev, host-deployment and shared-database child nodes is retained in their current files as historical detail, but those paths are no longer design nodes and are not separate assignments. Read them as prior inspection notes only; this README is the entry point for the consolidated system. `host-common.mjs` fingerprints processes and uses a durable lock; development config initialization and deployment manifest/release handling are implemented in `develop.mjs` and `deployment.mjs` respectively. Compose YAML needs direct inspection before implementation planning. Requirements newly accepted—separate Compose file/project/container/volume stable for this checkout, two databases on that service, strict non-interference with the legacy service—are not yet verified or implemented.

## Verification and continuation

No tests run. Next, inspect `scripts/database.mjs`, all Compose arguments in `host-common.mjs`, and `backend/compose.yaml`; determine how this checkout can obtain a stable unique Compose identity without accidental volume reuse after relocation. Then implement only after the user requests implementation (and within mapped source authority), and add lifecycle tests proving legacy service/data are untouched and both environments use the new service. Existing scripts/test cases and the consolidated Operations design define verification targets.
