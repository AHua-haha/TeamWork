# Desktop implementation context

## Result summary

The first Electron host implementation is in `desktop/`. It builds the shared frontend under `frontend/`, stages only `frontend/dist/` into `desktop/.build/frontend-dist`, compiles the Electron main/preload host, and packages that output for macOS. The desktop project has no React feature source.

At startup, Electron reads `desktop.json` under `app.getPath('userData')`. Its `backendOrigin` must be an explicit absolute HTTP/HTTPS origin. Missing/invalid config shows a diagnostic page; the app does not choose a fallback or launch the backend. The host serves packaged frontend assets through a constrained `teamwork://app` protocol and forwards only `/agents`, `/config`, and `/workspaces` API requests to the configured backend. The renderer’s shared `BackendClient` routes through this same-origin bridge. Browser requests remain relative and continue using the existing Vite proxy in development.

The window has Node integration disabled, context isolation and sandbox enabled. The preload exposes only the typed API base; main validates its sender. External navigation is denied except selected HTTPS links opened externally, and renderer permission requests/webviews are denied.

## Interface and effects

**Input:** `desktop.json` in Electron's per-user application data directory (`{"backendOrigin":"http://127.0.0.1:3100"}` is an example only); shared frontend production output; existing HTTP/SSE API.

**Output:** macOS Electron window hosting the shared frontend; API traffic forwarded through the `teamwork://app/api/` protocol handler; explicit config error view if configuration is absent or invalid and structured `backend_unreachable` errors when requests cannot connect.

**Effect:** Main process owns window/app lifecycle, reads config, serves packaged static assets and proxies the allowlisted API paths. Preload exposes only `desktopAPI.apiBase`. The frontend transport adapter maps API calls into that same-origin bridge when desktop is present; otherwise it leaves browser calls relative. Backend remains independently managed and owns business effects.

**Security:** Renderer has no Node access; context isolation and sandbox remain enabled. Preload only exposes small, typed and approved desktop APIs. IPC senders and navigation are constrained. Localhost is not itself authentication; the unauthenticated backend needs an explicit local security boundary before general distribution.

## File lookup

- Design: [Desktop](../../DESIGN.md)
- Proposed implementation root: `desktop/`
- Shared frontend source (owned by Frontend): `frontend/src/`
- Shared frontend build output consumed by desktop packaging: `frontend/dist/`
- Existing shared backend client: `frontend/src/shared/backend-client/`
- Desktop runtime config: `app.getPath('userData')/desktop.json`, containing `backendOrigin`.
- Desktop build/package commands: `npm run build`, `npm run package:mac`, `npm run make:mac` from `desktop/`.
- Desktop setup and config instructions: [desktop/README.md](../../../../../desktop/README.md)
- Build environment: macOS + Xcode Command Line Tools + Node.js 22.19.x LTS (`desktop/.nvmrc`).

## Verification and open work

Validation under Node.js 22.19.0 (npm 10.9.3): clean `npm ci` completed; Electron reports `v37.10.3`. With `NODE_OPTIONS` unset, `npm start` built the frontend and host and launched Electron main/GPU/utility/renderer processes. `npm run package:mac` produced the `.app`, ZIP and DMG; the DMG checksum verified and it mounted with `RSI Agent.app`. Launching the generated `.app` also started its renderer. Forge reported a `socket hang up` during finalization despite producing artifacts, so its exit status remains a network concern. All test processes were stopped cleanly.

A direct launch retry also found an environment issue: `~/.zshrc` globally appends Node 26's `--use-env-proxy` to `NODE_OPTIONS`, which Node 22 rejects before npm starts. Desktop does not set this option. Remove it from the shell startup file or run `unset NODE_OPTIONS`. With Node 22 and that variable unset, an isolated `electron-forge start -- --user-data-dir=/tmp/team-work-electron-test` launch also created Electron main/GPU/utility/renderer processes successfully. `git diff --check` passes.

Remaining distribution work: code signing/notarization and a suitable authenticated local-backend boundary before public distribution. The backend currently has no built-in authentication; loopback binding alone is not authentication.

## Automatic retrieval

```json
{"commands": []}
```
