# Desktop implementation context

## Result summary

Desktop is a new Electron shell design for the existing React + TypeScript frontend. Its first version only connects over the existing HTTP/SSE API to a separately installed backend already started by the user. Electron must not bundle, launch, supervise or stop the backend. The web frontend remains independent and unchanged in behavior.

This design is pending review. One product choice remains open: how the desktop obtains and persists the backend API origin. Do not implement a guessed default. The initial design names a typed backend-origin input as a requirement, but its source/default/persistence requires user confirmation.

Future direct/in-process backend integration is explicitly out of scope and requires a separate accepted design.

## Interface and effects

**Input:** Desktop startup plus an explicitly configured backend origin; existing shared React frontend and `BackendClient` perform backend HTTP/SSE operations.

**Output:** Electron window hosting the same frontend as web; explicit connection/unreachable errors if the backend is unavailable.

**Effect:** Electron owns native window/application lifecycle and narrowly designed native desktop integration only. It does not run backend processes, Agent execution, workspace file operations, Bash, or business workflows. Backend remains owner of those capabilities.

**Security:** Renderer has no Node access; context isolation and sandbox remain enabled. Preload only exposes small, typed and approved desktop APIs. IPC senders and navigation are constrained. Localhost is not itself authentication; the unauthenticated backend needs an explicit local security boundary before general distribution.

## File lookup

- Design: [Desktop](../../../design/desktop/design.md)
- Proposed implementation root: `desktop/`
- Existing shared web frontend: `frontend/src/`
- Existing backend client: `frontend/src/shared/backend-client/`
- Existing lifecycle commands: `scripts/`

## Verification and open work

No Electron source implementation or dependencies have been added. First settle the backend-origin configuration workflow; then assign the implementation work. Validate shared frontend browser behavior and Electron development/package flows separately. Code signing, auto-update, platform distribution and backend authentication hardening remain open product/operations/security work.

## Automatic retrieval

```json
{"commands": []}
```
