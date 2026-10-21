<!-- Task proposal; current contract is under docs/systems/ -->
# Host deployment implementation

## Contract

[Host deployment lifecycle](design.md). Deployment preserves existing database/key, exports committed source to temporary storage and serves built frontend/backend directly on the host.

## Responsibilities and decomposition

Deployment orchestration owns release building, selection, readiness and recovery. [Shared database](../shared-database/design.md) owns shared MySQL. Common helpers own environment initialization and process identity. A small frontend host owns static assets and streaming HTTP proxy; application business logic and runtime remain unchanged.

## Coordination and data flow

The shell wrapper invokes deployment.mjs from the project base. host-config initializes the private project rsi.config.json by importing legacy settings once, then derives environment-specific backend values from its shared database address and separate accounts/keys. host-common passes these values only to managed child processes. Ref resolution uses git rev-parse --verify --end-of-options; git archive exports only committed files to a unique SHA-prefixed temporary release. npm ci --include=dev installs each lockfile before its build. The backend runs dist/src/main.js and receives deployment settings directly through its process environment; source .env files are absent from the snapshot. The frontend host serves frontend/dist and proxies /agents, /config and /workspaces to the loopback backend. Requests/results are piped with backpressure, binary payloads remain binary, SSE headers flush immediately and disconnect closes upstream work. Static serving rejects hidden/traversing paths and symlinks outside the build directory; missing assets do not become HTML.

The update dispatcher requires active.json, defaults its ref to HEAD and resolves it with the same local commit resolver as deploy. For a changed commit it calls the existing deploy path; for the same commit it calls start, reusing the selected files/processes or rebuilding missing temporary files. It performs no fetch, pull or checkout.

Release compilation completes before old processes stop. A successful ready pair publishes active.json atomically. Failed launch stops its managed children and attempts previous running release recovery. Start reconstructs missing temporary source using the saved commit, preserving durable settings/logs. Old snapshots are retained for recovery and may be removed when stopped; there is no database rollback or automatic release pruning.

## Decisions and constraints

Source root is required to be a real descendant of /tmp or the platform temporary root. Deployment state is outside that default source root. PID identity is checked using the actual command and process start even after source deletion. Status/logs need no running database or source. MySQL Compose project remains backend irrespective of source snapshot location. Port changes need restart. No Vite preview server, source worktree, TLS, daemon supervisor or application schema changes are introduced.

## Code map

- [Deployment wrapper](../../../scripts/deploy.sh) and [orchestrator](../../../scripts/deployment.mjs).
- [Configuration/process helper](../../../scripts/host-common.mjs).
- [Frontend static/streaming host](../../../scripts/serve-frontend.mjs).
- [Usage](../../../README.md).

## Verification

[Lifecycle tests](../../../scripts/test/deployment.test.mjs) exercise real Git archives, locked fixture builds, source/state isolation, repeated starts, failed-build preservation, failed-launch recovery, temporary cleanup, foreign PIDs/ports and command exclusion. Update tests verify default HEAD changes, explicit version selection, unchanged checkout/configuration, same-version process reuse, invalid-ref preservation and refusal before initial deployment. [HTTP tests](../../../scripts/test/frontend-host.test.mjs) exercise real static, upload, SSE/cancellation and proxy failure behavior. Real package builds and actual host/database transition are recorded in the task tests.jsonl. No paid provider request is needed for environment validation.

## Project configuration authority

[scripts/host-config.mjs](../../../scripts/host-config.mjs) owns JSON schema validation, one-time import, private atomic creation, shared-address derivation and clean child environments. [Project example](../../../rsi.config.example.json) contains no credentials. Legacy env files are migration inputs only and remain untouched. HOST/PORT/database/key/proxy/output directories are generated from the chosen config section for each child. No process.env mutation or shell-profile write is used. Application readiness bypasses ambient proxies. Service fingerprints cover all passed settings so changed credentials/options require restart; deployment/development and Docker remain separately owned.

## Harness enforcement setting

The environment section accepts optional Boolean harnessPermissionsEnabled (default true). host-config validates the value and emits RSI_HARNESS_PERMISSIONS_ENABLED in backendSettings; inherited RSI_* values and environment-map overrides cannot change it. The backend parses it strictly and injects it into harness assembly. It participates in the existing all-settings service fingerprint; changing it requires restart, never a live in-place policy mutation. Native host config and lifecycle tests verify omitted/enabled/disabled values and independent deployment/development selection.
