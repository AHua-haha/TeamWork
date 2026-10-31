---
summary: Hosts the shared frontend in a sandboxed Electron window and forwards its HTTP/SSE requests to an explicitly configured external backend; provides unsigned macOS packaging.
include:
  - desktop/src/main/main.ts
  - desktop/src/main/config.ts
  - desktop/src/main/preload.ts
  - desktop/scripts/copy-frontend.mjs
  - desktop/package.json
  - desktop/package-lock.json
  - desktop/forge.config.cjs
  - desktop/tsconfig.json
  - desktop/test/config.test.ts
  - desktop/README.md
  - frontend/src/app/main.tsx
  - frontend/src/shared/backend-client/transport.ts
  - frontend/test/backend-transport.test.ts
  - scripts/desktop.mjs
  - .rsi/rsi-agent/scripts/_ctx/README.md
---

# Desktop usage contract

Desktop is an optional Electron host for the same React/TypeScript application built from `frontend/`. Its ordinary descendants are owned here; there are no separately documented descendant design parts. The host owns its windows, startup configuration, local asset/proxy protocol and packaging. Frontend owns feature interactions and the public `BackendClient`. Backend owns application records and business/tool effects. Electron does not launch, bundle, supervise or stop a backend.

## Startup and configuration

**Input:** On application readiness, main reads UTF-8 JSON from `path.join(app.getPath('userData'), 'desktop.json')`, after setting the application name to `RSI Agent`. On macOS the usual path is `~/Library/Application Support/RSI Agent/desktop.json`; the missing-file error reports the actual resolved path.

The object must contain a nonempty string `backendOrigin`. `parseDesktopConfig(unknown)` returns `{backendOrigin: string}` or throws an `Error`. Unknown object properties are ignored. The string must exactly equal the URL parser's normalized HTTP/HTTPS origin: credentials, paths including a trailing slash, query, fragment, surrounding whitespace and noncanonical spellings are rejected. An explicit example, not a default, is:

```json
{"backendOrigin":"http://127.0.0.1:3100"}
```

**Output/effect:** Main reads the configuration once and creates a 1280×850 window, minimum 760×600, loading `teamwork://app/index.html`. It neither creates nor rewrites the configuration file and has no configuration editor or automatic reload. A changed file requires an application restart. No health check or backend launch precedes opening the frontend; connection attempts happen when it makes API requests.

**Failure:** Missing/unreadable files, malformed JSON and invalid values produce an HTML configuration-error view with an escaped error message and restart instructions. There is no fallback origin. In this error state the protocol serves the error HTML instead of frontend assets/API traffic. A valid but unreachable backend produces request-time errors described below.

## Renderer and network interaction

Main registers a privileged, standard, secure `teamwork` scheme with Fetch/CORS support. Preload makes the synchronous, fixed `desktop:get-api-base` request. Main returns `teamwork://app/api/` only when `event.senderFrame?.url` starts with `teamwork://app/`; otherwise it returns `null`. Preload exposes a frozen `window.desktopAPI` object only when the reply is a string:

```ts
interface DesktopAPI { readonly apiBase: string }
// Provided at startup: window.desktopAPI.apiBase === 'teamwork://app/api/'
```

This is the entire renderer capability; it exposes no arbitrary IPC, filesystem, process or Electron API. The configured upstream backend origin stays in main rather than being exposed to the renderer.

App startup calls `configureBackendBase(window.desktopAPI.apiBase)` when the global exists. The shared transport then maps relative endpoint strings into the local API base. Without the Electron global, browser requests retain their existing relative paths and web proxy/same-origin behavior. Features continue to use the same `BackendClient` facade and JSON, binary and SSE representations.

For example, a feature's `backend.workspaces.list()` goes through the shared transport to `teamwork://app/api/workspaces`; main forwards it to `<backendOrigin>/workspaces`. The host does not interpret workspace records or implement feature workflows.

### API forwarding

**Input:** Requests to `teamwork://app/api/…` whose stripped path starts with `/agents`, `/config` or `/workspaces` at a path-segment boundary. Other API roots and unexpected protocol hosts receive 404. Methods are forwarded without a separate method allowlist. Path and query select the corresponding endpoint under the configured origin.

**Output:** Upstream HTTP status, status text, response headers and body stream, including JSON, binary responses and SSE. Backend HTTP errors are returned with their upstream status/body. The host does not synthesize backend events, own reconnect policy or validate business responses.

**Effect:** Main uses Fetch to contact the configured backend. It copies request headers except `host` and `origin`, reads non-GET/HEAD request bodies into an array buffer, and forwards the body. It strips `content-encoding`, `content-length`, `transfer-encoding` and `access-control-allow-origin` from response headers before returning the upstream stream. Fetch's ordinary redirect behavior applies; the proxy does not implement authentication or a separate redirect policy.

**Failure/limits:** Fetch or request-forwarding exceptions return HTTP 503 with `{"error":{"code":"backend_unreachable","message":"Unable to connect to configured backend at <origin>"}}`. This message covers forwarding exceptions generally, not a dedicated diagnosis of backend health. The proxy adds no request timeout, retry or explicit propagation of the renderer's abort signal to upstream Fetch. SSE reconnect/cursor behavior remains the shared client's responsibility; disconnecting the renderer is not a backend-work cancellation operation.

### Static assets and window lifecycle

In development, main reads `frontend/dist` directly. In a packaged app it reads `frontend-dist` under `process.resourcesPath`. `/` maps to `index.html`; other paths map directly to files with no SPA fallback. Decoding failures, traversal outside the asset root and missing files receive 404; other file-read failures receive 500. HTML, JavaScript, CSS, SVG and PNG have explicit MIME types; other extensions use `application/octet-stream`. HEAD requests return headers without an asset body.

Assets carry a content security policy restricting script/connect sources to the local application, denying objects and embedding by ancestor frames, and permitting the inline styles/data/blob images used by the frontend. Node integration is disabled, context isolation and renderer sandboxing are enabled. With valid configuration, permission requests are denied and webview attachment is prevented.

Top-level navigation outside the `teamwork://app/` prefix is prevented. New windows are always denied; HTTPS links with hostname `github.com` or `docs.rs` are instead passed to the operating system's external browser. Other links are denied.

Closing the last window quits on non-macOS platforms. On macOS the process remains running; after successful configuration, application activation recreates a missing window. The configuration-error startup branch does not register that activation handler, so closing its only macOS window requires quitting/restarting the process to reopen it.

## Build, development and package usage

**Input:** Node matching the package engine `>=22.19.0 <23` (the repository pins 22.19.0), installed locked dependencies for `frontend/` and `desktop/`, and the shared frontend source. macOS package creation additionally needs the platform tooling described in `desktop/README.md`.

From the repository root:

```sh
nvm use
npm ci --prefix frontend
npm ci --prefix desktop
npm run build --prefix desktop
npm start --prefix desktop
```

`build` runs the shared frontend's production build, replaces `desktop/.build/frontend-dist` with a copy of `frontend/dist`, and compiles main/preload into `desktop/dist`. Copying removes the previous staging directory before copying, so a failed copy can leave incomplete staging. `start` performs the whole build before invoking Electron Forge; it does not launch a Vite development server or provide hot reload. The host itself still reads `frontend/dist` in development.

```sh
npm run package:mac --prefix desktop
npm run make:mac --prefix desktop
npm test --prefix desktop
```

`package:mac` builds and packages a macOS application; `make:mac` builds and produces macOS ZIP/DMG artifacts through Forge. Forge uses the name `RSI Agent`, bundle ID `com.rsiagent.desktop`, ASAR packaging and the staged frontend output as an extra resource. These commands select `darwin` but do not explicitly select CPU architecture. Outputs are under `desktop/out/`; their concrete artifact names follow Forge. The configuration has `osxSign: false` and no signing, notarization, updater or release-delivery workflow. Tests cover explicit origin acceptance/rejection; frontend transport tests cover the browser-relative and desktop API-base paths.

Build/install/Forge errors surface through the command's nonzero exit; there is no alternate frontend, backend fallback or recovery release. Packaging consumes the frontend build output rather than a second maintained React source tree.

## Operations integration and boundaries

The separately owned `scripts/desktop.sh start development|deployment` is an optional Operations test launcher. Its implementation selects/starts a backend and supporting database, temporarily writes the desktop configuration, invokes this package's `npm start`, and restores the prior config afterward. Those process/configuration effects belong to Operations, not Electron. Deployment selection applies to that launcher's backend; it still builds the desktop/frontend from this checkout. See Operations' usage README and `scripts/desktop.mjs` for lifecycle details.

The Electron proxy is transport adaptation, not authentication or authorization. Accepted configuration may point to any canonical HTTP/HTTPS origin; localhost alone does not authenticate requests. No authenticated local-access boundary is implemented in this host. General distribution still requires a decision about that boundary. This contract does not promise an embedded backend, native feature dialogs/menus, platform-wide distribution, signing or automatic updates.
