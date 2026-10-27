# Desktop implementation context

## Result summary

Desktop is an Electron host for the same React + TypeScript frontend used by the web app. The frontend source remains owned and developed under `frontend/`; Desktop owns no frontend source, fork, or feature workflows. Desktop packaging consumes and bundles the shared frontend build output. The desktop connects over the existing HTTP/SSE API to a separately installed backend already started by the user. Electron never bundles, starts, supervises or stops the backend.

At startup, the Electron main process reads the backend API origin from a desktop config file in Electron's per-user application data directory. The origin is passed to the shared frontend through a narrow typed startup interface. Missing, malformed or invalid config produces an explicit error; no origin is guessed or silently defaulted. This resolves the backend-origin source decision, but the exact config schema and implementation are still to be built.

Future direct/in-process backend integration is explicitly out of scope and requires a separate accepted design.

## Interface and effects

**Input:** Desktop startup; backend API origin from a per-user Electron configuration file; shared React frontend build; existing `BackendClient` HTTP/SSE operations.

**Output:** Electron window hosting the exact shared frontend build; explicit configuration/connection errors when config is absent/invalid or backend unreachable.

**Effect:** Electron owns native window/application lifecycle, packages the shared frontend build output, reads desktop configuration and exposes narrowly designed startup information. It owns no frontend source, backend process, Agent execution, workspace file operations, Bash, or business workflows. Backend remains owner of those capabilities.

**Security:** Renderer has no Node access; context isolation and sandbox remain enabled. Preload only exposes small, typed and approved desktop APIs. IPC senders and navigation are constrained. Localhost is not itself authentication; the unauthenticated backend needs an explicit local security boundary before general distribution.

## File lookup

- Design: [Desktop](../../../design/desktop/design.md)
- Proposed implementation root: `desktop/`
- Shared frontend source (owned by Frontend): `frontend/src/`
- Shared frontend build output consumed by desktop packaging: `frontend/dist/`
- Existing shared backend client: `frontend/src/shared/backend-client/`
- Desktop runtime config: per-user Electron application data directory; contains backend API origin (schema to be finalized during implementation).
- Existing lifecycle commands: `scripts/`

## Verification and open work

No Electron source implementation or dependencies have been added. The backend-origin source decision is settled: Electron reads it from a config file in the per-user app data directory. Still to implement: config schema/validation, typed startup handoff to the shared `BackendClient`, Electron host, and packaging dependency that builds and bundles `frontend/dist/` without creating a desktop-owned frontend source tree. Validate shared frontend browser behavior and Electron development/package flows separately. Code signing, auto-update, platform distribution and backend authentication hardening remain open product/operations/security work.

## Automatic retrieval

```json
{"commands": []}
```
