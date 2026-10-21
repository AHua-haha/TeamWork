# Backend Runtime

## Purpose, responsibilities and boundaries

Backend Runtime is the process lifecycle and dependency wiring layer. It owns exactly one file: `main.ts`, the composition root. Runtime reads environment configuration, instantiates all concrete implementations (store, domain services, harness commands), wires their dependencies, starts the HTTP server, acquires the database ownership lock, runs startup migrations, and registers shutdown handlers.

Runtime is the only layer permitted to know every concrete implementation. No business rules live here — every "may this happen?" question belongs in Domain, every "how is this persisted?" in Storage. Runtime's sole job is to construct the running system and hand control to API.

## Interface contract

**Purpose and supported interactions.** `main.ts` is the entry point for the Node.js process. It:
- Reads `DATABASE_URL` and `ENCRYPTION_KEY` from environment
- Instantiates `MySqlStore` and calls `migrate()` plus `acquireOwnership()`
- Constructs domain services: `ConfigService`, `WorkspaceService`, `TeamSystem`, `AgentRuntime`
- Wires `webTools` and `closeBashRuntime` lifecycle hooks
- Calls `createAgentServer(runtime, config, workspace, team)` from API
- Binds the HTTP server to loopback and the configured port
- Registers SIGTERM/SIGINT handlers for clean shutdown

**Required inputs and returned information.** Environment supplies `DATABASE_URL`, `ENCRYPTION_KEY`, optional `PORT` (default 3000). `main.ts` logs startup messages and process readiness, then runs until shutdown signal.

**Observable effects.** The process binds an HTTP port, acquires a database ownership lock, runs schema migrations, and starts agent execution. Shutdown closes the server, releases the lock, and stops background jobs.

**Failure behavior.** Missing environment config, database connection failure, or ownership conflict exits the process with error logs. Startup migration failure also exits. After successful startup, unhandled errors in request handlers are caught by the HTTP server; they do not crash the process.

## Constraints, specifications and requirements

- `main.ts` is the only file that imports `MySqlStore` from Storage directly. All other layers depend on the `Store` interface.
- Runtime must not contain policy. It constructs and wires; Domain decides.
- Known violation (accepted as necessary): `main.ts` imports concrete `MySqlStore` and every domain service — this is the composition root's explicit responsibility.
