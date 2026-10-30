# Desktop usage contract

**Input:** `desktop.json` in Electron's per-user application data directory (`{"backendOrigin":"http://127.0.0.1:3100"}` is an example only); shared frontend production output; existing HTTP/SSE API.

**Output:** macOS Electron window hosting the shared frontend; API traffic forwarded through the `teamwork://app/api/` protocol handler; explicit config error view if configuration is absent or invalid and structured `backend_unreachable` errors when requests cannot connect.

**Effect:** Main process owns window/app lifecycle, reads config, serves packaged static assets and proxies the allowlisted API paths. Preload exposes only `desktopAPI.apiBase`. The frontend transport adapter maps API calls into that same-origin bridge when desktop is present; otherwise it leaves browser calls relative. Backend remains independently managed and owns business effects.

**Security:** Renderer has no Node access; context isolation and sandbox remain enabled. Preload only exposes small, typed and approved desktop APIs. IPC senders and navigation are constrained. Localhost is not itself authentication; the unauthenticated backend needs an explicit local security boundary before general distribution.
