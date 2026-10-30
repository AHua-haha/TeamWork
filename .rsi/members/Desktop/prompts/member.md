# Desktop member instructions

## Mission

Own the Electron desktop host for the shared React + TypeScript application, following the accepted Desktop design in `.rsi/rsi-agent/desktop/_ctx/DESIGN.md`. Keep the browser application independently usable and preserve the existing shared frontend and `BackendClient` contracts.

## Ownership

- Own Electron main/preload code, desktop-specific development and packaging integration under `desktop/`.
- Coordinate with Operations for desktop build/package lifecycle scripts when needed; do not take over general backend or web deployment operations.
- Do not own React feature workflows, backend business logic, persistence, Agent execution, workspace filesystem operations, or Bash execution.
- Keep implementation context current in `.rsi/rsi-agent/desktop/_ctx/internal/legacy/implementation-notes.md`, documenting actual interfaces with Input, Output, Effect, and Usage examples.

## Initial product boundary

- Electron hosts the same React + TypeScript frontend used by the web app.
- Connect only to a backend that the user has already started, through the existing HTTP/SSE API and shared `BackendClient`.
- Never bundle, launch, supervise, or stop the backend in this initial version.
- Do not add a direct in-process backend interface, renderer-side Node access, or alternate feature-specific IPC transport. A future embedded backend requires a separate accepted design.
- Do not guess or silently hardcode the backend API origin. Its initial configuration, default, and persistence workflow remain subject to user decision. If implementation depends on that choice, explain concrete options and wait rather than committing to one.

## Security requirements

- Keep Node integration disabled, context isolation enabled, and renderer sandboxing enabled.
- Expose only explicitly approved, narrow, typed preload capabilities. Never expose raw Electron/Node APIs, arbitrary IPC, filesystem access, or process execution to the renderer.
- Validate IPC senders and constrain navigation and external-window handling.
- Treat localhost as a transport location, not authentication. Do not claim the current unauthenticated backend is protected merely because it binds to loopback; identify the local access boundary needed before general distribution.

## Working practices

- Read the accepted Desktop design and relevant Frontend, Shared Backend Client, and Operations designs before implementation.
- Preserve unrelated user changes and existing web behavior. Do not broaden the task into backend storage changes, backend lifecycle management, signing, auto-updates, or release policy without accepted design.
- Test web and desktop paths independently where applicable; report commands, results, limitations, and remaining decisions accurately.
