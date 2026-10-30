# Desktop (Electron)

## Purpose, responsibilities and boundaries

Desktop provides an optional native desktop shell for the existing application. It hosts the same React + TypeScript frontend used by the web app and connects to a separately installed and already-running backend. Desktop does not own or fork frontend source code: frontend development remains under `frontend/`, and desktop packaging consumes the frontend's build output. Desktop does not install, launch, supervise, bundle, or stop the backend. The web app remains independently usable.

## Interface contract

The Electron main process owns desktop application/window lifecycle, native menus and dialogs only when explicitly designed, and secure renderer setup. The renderer loads the shared frontend build and uses its existing `BackendClient` over the backend's HTTP/SSE API. Desktop build/package integration depends on the frontend build and packages its output; desktop does not maintain a second React application, frontend source tree, or feature implementation. Electron does not duplicate feature workflows, backend business logic, persistence, agent execution, workspace file access, or Bash execution.

The initial desktop app must not bundle backend code and must not launch or manage backend processes. The backend is provisioned and started separately by the user using the existing Operations lifecycle. At startup, Electron reads a desktop configuration file in the per-user Electron application data directory. The file supplies the backend API origin to the shared frontend through a narrow typed startup interface. Missing, malformed, or invalid configuration is an explicit connection/configuration error; the app must not silently select a backend origin or fall back to a development URL.

The renderer remains a web-compatible React application. Electron-specific behavior, if needed, is exposed through a narrowly scoped typed preload API. Do not expose raw Electron/Node APIs, arbitrary IPC, workspace filesystem access, or process execution to the renderer. Keep Node integration disabled, context isolation and renderer sandboxing enabled, validate IPC senders, and restrict navigation and external-window handling. The ordinary browser build must work without Electron globals.

Desktop packaging depends on a successful shared frontend build and packages its static output with the Electron host. It does not copy frontend sources into a separately maintained desktop source tree. Frontend can still be built and served independently for web use. Desktop packaging is separate from the existing web frontend build and host deployment lifecycle. The first increment is local development and packaging; signing, update delivery, and platform distribution policy are not specified here.

A future version may bundle a backend runtime and use a direct in-process/service interface rather than HTTP, but this is explicitly out of scope for the initial desktop app. That future option must preserve backend ownership boundaries, shared web frontend behavior, security and data migration guarantees; it requires a separate accepted design before implementation.

## Constraints and acceptance

- One React/TypeScript feature implementation serves web and desktop; desktop owns no frontend source or fork.
- Desktop packaging consumes and bundles the shared frontend build output.
- Desktop never launches, bundles, stops, or owns the backend in this version. It only connects to a backend the user has already started.
- Desktop reads the backend origin from its per-user configuration file at startup; missing or invalid configuration is explicit, with no guessed fallback.
- Existing web HTTP/SSE behavior and backend client contracts remain unchanged.
- Backend stays authoritative for application state, workspace filesystem/tool effects, and authorization/permissions.
- Electron main/preload code owns only desktop integration; renderer code receives no direct Node.js access.
- Missing, invalid, or unreachable backend configuration is shown as an explicit connection failure; no automatic backend launch or fallback endpoint.
- The backend's lack of built-in authentication is a launch/security consideration. Do not claim localhost alone authenticates desktop requests; document or implement a suitable local access boundary as a prerequisite to public distribution.
- Child implementation: `desktop/`.
