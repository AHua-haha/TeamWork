# Operations

## Purpose, responsibilities and boundaries

Operations runs this project on the operator's host in two independent environments: development from the current checkout and deployment from a committed Git revision exported to replaceable temporary storage. Both environments use a dedicated MySQL service belonging to this checkout, isolated from another branch's legacy service. Development and deployment have separate databases and encryption keys. Operations owns lifecycle CLIs, environment configuration, database service/provisioning, and the deployment static/streaming frontend host.

Operations does not own application schemas or records (the backend migrates and owns them), the meaning of provider credentials, or user project/workspace files. Deploying application source never copies or moves workspace files.

## Interface contract

**Purpose and supported interactions.** The operator uses three shell entry points:

- `scripts/dev.sh`: `init`, `start`, `stop`, `restart`, `status`, `logs [backend|frontend]` for checkout-based backend/Vite development.
- `scripts/deploy.sh`: `init`, `deploy <git-ref>`, `update [git-ref]`, `start`, `stop`, `restart`, `status`, `logs [backend|frontend]` for host deployment.
- `scripts/database.sh`: `start`, `stop`, `status` for this checkout's dedicated MySQL service and database provisioning.

Node.js 22.19+, npm, Git, tar, curl, ps and Docker Compose are required as applicable. Development defaults to loopback backend/frontend ports 3000/5273; deployment defaults to 3001/5274. Occupied ports fail rather than taking over unrelated processes. Deployment's source root defaults to `/tmp/rsi-agent-deploy`, durable state to `~/.local/state/rsi-agent` (respecting `XDG_STATE_HOME`); `RSI_STATE_DIR` and `RSI_DEPLOY_ROOT` may select locations, with the deploy root constrained to the system temporary directory. `RSI_DEPLOY_BACKEND_PORT` and `RSI_DEPLOY_FRONTEND_PORT` may select distinct deployment ports.

**Observable effects and lifecycle.** Development and deployment run independently and connect to separate databases on this checkout's dedicated MySQL service: `rsi_agent_dev` and `rsi_agent`. The service uses a Compose configuration/project and persistent volume distinct from the other branch's legacy service. First initialization creates empty databases; legacy records are neither copied nor modified. Deployment retains its existing encryption key, but prior database records and saved provider connections are unavailable in the new empty database. Development gets an independent key. Environment-specific config determines database/key; an inherited `DATABASE_URL` must not accidentally redirect either environment.

Development `start` ensures this checkout's MySQL service is healthy and development database/account provisioning is complete, then starts backend and Vite and checks readiness. Deployment initialization preserves existing deployment configuration/key before initializing both environments. `deploy <git-ref>` resolves a locally available committed revision, exports a separate temporary release, installs locked dependencies and builds before stopping the current deployment; uncommitted edits and environment files are excluded. It launches the compiled backend and a host frontend serving built assets while proxying API, uploads and SSE to the backend. Readiness precedes active-release selection. `update [git-ref]` selects the requested local committed revision (default: checkout committed HEAD); it does not fetch, pull or switch branches. Starts can rebuild the selected exact revision if temporary build files were removed. App stops do not stop either database service; only explicit database stop stops this checkout's service, preserving its volume.

**Failure behavior and lifecycle guarantees.** Invalid refs/configuration, missing dependencies, occupied ports, corrupt/missing keys, service health/provisioning errors and readiness failures return nonzero without logging secrets. A build failure leaves the running deployment intact. A launch failure stops newly launched processes and attempts recovery of the prior running release; recovery failure is explicit and does not roll back database migrations. Lifecycle mutations are serialized/refuse concurrency. Process termination requires positive process identity; stale/reused PIDs or ports never justify killing foreign processes. Status is read-only; logs do not require a running database. Failed development startup stops only processes started by that attempt and leaves both MySQL services and deployment intact. Failed DB startup does not stop either service. Provisioning never drops/truncates/resets databases, rotates deployment credentials, or copies data. Explicit database stop affects only this checkout's service and preserves its volume.

The deployment frontend keeps API/upload responses streaming rather than buffering whole bodies; SSE remains live and disconnects close proxy requests. Local readiness requests bypass shell HTTP proxy settings.

## Constraints, specifications and requirements

- Deployment refs must resolve to a local committed revision containing required scripts and host frontend entry; historical source must remain locally available to rebuild. No automatic fetch, branch switch, or inclusion of uncommitted changes.
- Deployment source/build files are replaceable and must not contain deployment keys or user workspaces. Durable state, logs, release selection and user workspaces remain outside the temporary source tree.
- Development and deployment use distinct encryption keys and databases. The deployment key is retained, but cannot restore records absent from the new database.
- The dedicated Compose config/project, container and named-volume identity must be unique to and stable for this checkout, distinct from the other branch's legacy service, and must not silently attach to an unrelated volume if the checkout moves. Identity derivation/storage is an implementation decision; collision/move behavior must fail safely.
- Repeated service starts/provisioning preserve both databases' data. Stopping either application leaves both MySQL services available. Explicit service stop is scoped to this checkout and preserves its volume.
- Process management must not kill foreign processes; concurrent lifecycle mutations are refused; secrets are not logged or placed on process arguments.
- Both applications bind to loopback by default. No TLS, public exposure, boot supervisor, automatic update, app schema change, destructive data reset, or legacy-service mutation is introduced.
- Database separation does not isolate manually shared project directories. Users should stop both applications before intentionally stopping this checkout's MySQL service.
- Acceptance: initialize with legacy data present and verify legacy service/data remain untouched while this checkout's two databases start empty; start both apps and verify each UI reaches its own backend; stop/restart one app without affecting the other app or either database service; test foreign occupied ports, build/readiness recovery, rebuild after temporary source deletion, streaming SSE and image uploads.

## Implementation mapping

`scripts/host-common.mjs` provides shared durable paths, environment validation, process identity, locking, logging and readiness. `scripts/develop.mjs` and `scripts/dev.sh` manage development lifecycle. `scripts/deployment.mjs`, `scripts/deploy.sh` and `scripts/serve-frontend.mjs` manage release selection and host serving/proxying. `scripts/database.mjs` and `scripts/database.sh` manage the checkout-specific MySQL lifecycle and provisioning. `backend/compose.yaml` contains the legacy service configuration and must remain unaffected unless the implementation adds a separately identified compose configuration. `scripts/test` contains lifecycle tests.
