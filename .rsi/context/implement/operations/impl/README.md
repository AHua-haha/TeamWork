# Operations — implementation context

## Result summary

Operations uses the project-root `operations.config.json` as its sole tunable-settings source. The accepted Operations design now requires a preconfigured, named MySQL container and named persistent volume managed with Docker Engine commands only. The database lifecycle no longer generates Compose YAML or invokes `docker compose`; `backend/compose.yaml` remains untouched.

`database.containerName`, `database.volumeName`, `database.image`, `database.port`, and `database.rootPassword` are explicitly configured. Before any mutation, Operations inspects the exact named container and volume, requiring project-owner/service labels and matching image, port binding, and data mount. A mismatch refuses the operation; it will not adopt, remove, recreate, or replace a resource. A matching existing volume is preserved. The container is created using `docker run`, resumed with `docker start`, stopped with `docker stop`, and inspected using `docker inspect`; database accounts are provisioned with narrowly scoped `docker exec` and SQL stdin. Provisioning uses create/alter/grant only.

The local root config has explicit names `rsi-agent-0a7750a95bef635f-mysql` and `rsi-agent-0a7750a95bef635f-mysql-data`, image `mysql:8.4`, and port `4211`. I have not started/stopped/provisioned this container or touched its volume as part of this change. The other service `backend-mysql-1` on port 3306 is not targeted. Docker-backed lifecycle behavior remains unverified on this change; the existing configuration may reference a previous container/volume state and will be refused unless ownership/settings match exactly.

Development and deployment use separate databases/accounts and separate encryption keys. App processes receive a deliberately assembled environment. App stop leaves the database running; explicit database stop preserves the named volume. Deployment retains its prior URL/status, recovery and port-conflict behavior.

## File lookup

| Path | Description |
|---|---|
| `.rsi/context/design/operations/design.md` | Accepted Operations requirements: root config only, plain Docker lifecycle, ownership checks, isolation and preservation. |
| `operations.config.example.json` | Non-secret configuration template with explicit container/volume/image fields. |
| `operations.config.json` | Local private config, ignored by Git; contains secrets and explicit identities. |
| `.gitignore` | Excludes private root config and `.operations/` state. |
| `scripts/host-common.mjs` | Root config loading/validation, app environment construction, paths, process safety, readiness and lifecycle lock. |
| `scripts/database.mjs` | Docker Engine identity verification, named container/volume lifecycle and non-destructive DB provisioning. |
| `scripts/develop.mjs`, `scripts/dev.sh` | Development app lifecycle. |
| `scripts/deployment.mjs`, `scripts/deploy.sh` | Host deployment, URL reporting, release build/selection and recovery. |
| `scripts/serve-frontend.mjs` | Static frontend server and streaming API/upload/SSE proxy. |
| `scripts/test/deployment.test.mjs` | Config/environment, deployment recovery, port safety and Docker mock tests. |
| `scripts/test/frontend-host.test.mjs` | Static serving, streaming, upload, SSE cancellation and path-safety tests. |
| `backend/compose.yaml` | Other/legacy service definition; Operations must not use or modify it. |

## Automatic retrieval

```json
{"commands": []}
```

## Implemented contract

### Docker database lifecycle

**Input:** Root config supplies container/volume names, the pinned image (`mysql:8.4`), host port and root credential. Docker Engine is installed and reachable.

**Output:** `databaseStatus()` reports whether the verified configured container is running. `startDatabase()` creates a missing named volume with ownership labels and creates a container with explicit port/mount/labels, or starts a matching stopped container. `stopDatabase()` stops only the validated configured container. `provisionEnvironment('development'|'deployment')` starts the service as needed and applies non-destructive SQL through stdin.

**Effect:** Persistent data remains in the configured named volume. No Compose resources are created. An existing container/volume with missing or mismatching ownership/settings causes safe refusal before mutations. Operations does not list, stop, delete, or mutate arbitrary containers or volumes.

**Usage:** `./scripts/database.sh status`, `./scripts/database.sh start`, `./scripts/database.sh stop`.

### Application settings and lifecycle

**Input:** Only `operations.config.json` specifies tunable values. Environment overrides, dotenv files and other config locations are not read as settings. `development.database` and `deployment.database` are constrained to `rsi_agent_dev` and `rsi_agent`; app encryption keys are separate.

**Output:** Development/deployment commands report status/logs and successful deployment URLs; errors exit nonzero. Occupied app ports are refused without signaling foreign processes.

**Effect:** App stop does not stop MySQL. Deploy builds committed local refs before replacing a running release and attempts recovery if new startup fails. Neither scripts nor spawned applications export changes to the caller's environment.

**Usage:** `./scripts/dev.sh start`; `./scripts/deploy.sh deploy HEAD`; `./scripts/deploy.sh status`.

## Verification and continuation

The deployment lifecycle tests pass (4/4) with a Docker CLI test double; frontend-host test passes (1/1); JavaScript syntax checks and `git diff --check` pass. The test double verifies the exact ownership labels/resource settings but does not execute Docker Engine lifecycle commands. Read-only Docker inspection shows the former Compose-managed checkout container `rsi-agent-0a7750a95bef635f-mysql-1` is running on port 4211, with Compose labels and volume `rsi-agent-0a7750a95bef635f_rsi-agent-0a7750a95bef635f-mysql-data`. It is not the explicit new configured container/volume identity and has no new ownership labels. The script therefore will refuse to manage/adopt it and will not start a second container on the occupied port. `backend-mysql-1` on port 3306 was inspected only; it was not modified. No volumes, containers, databases or data were changed. Safely transitioning the old project-owned Compose resources requires an explicit migration decision; do not remove its volume or stop the service to bypass ownership checks.

Follow-up: run the full Operations tests and, on an authorized Docker-enabled host, inspect the configured named resources before startup. The script must refuse old/unlabeled resources; do not delete volumes to bypass that check. Secrets are supplied to the Docker CLI through its process environment rather than command-line values; Docker persists container environment metadata, an inherent limitation to review if stronger secret-at-rest protection is required.
