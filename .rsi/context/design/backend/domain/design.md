# Backend Domain

## Purpose, responsibilities and boundaries

Backend Domain owns all use-case logic, capabilities, and mechanisms. This is where every interesting rule in the backend lives. Domain decides *what can happen* and *when it's allowed*: activation must be atomic and idle, publication must validate mention budget, reset requires idleness, context assembly follows specific precedence, harness authority maps file scopes to permissions.

Domain is now organized into six subsystems, each owning a distinct capability:

- **Config** — deployment/application/agent configuration, provider connections, model catalog, run snapshots
- **Workspace** — workspace registry, context base (design/impl trees), file versions, change records, project file API
- **Team** — member lifecycle, group chat, mention routing, activation, conversation context assembly
- **Harness** — tool selection, file authority, prompt composition, Bash execution, Git commit approval
- **Agent** — model–tool loop mechanism, progress buffering, run state, follow protocol
- **Web Tools** — web_search and web_fetch capabilities

Domain declares storage interfaces and calls them; it never writes SQL or imports `MySqlStore` directly. Domain never speaks HTTP, returns status codes, or frames SSE events — those belong to API. Domain contains the rules; API transports them; Storage persists their results.

## Interface contract

**What Domain does.** Domain exposes services and operations that API routes call:

- **Config system** — validate/resolve provider connections, model choices, catalog options, agent settings, workspace model defaults; snapshot run configurations
- **Agent runtime loop** — construct model requests from stored context, dispatch tool calls, manage progress FIFO, decide continuation, handle cancellation
- **Workspace service** — manage workspace registry, load/commit context changes, maintain design tree and implementation context, expose project files
- **Team system** — manage member lifecycle, validate/activate member configurations, route work, enforce mention budgets, assemble conversation context
- **Harness** — select tools, map file authority, compose prompts, approve commits
- **Context base** — maintain design/implementation hierarchies, track file versions, generate change feed
- **Group chat** — manage shared transcript, validate mentions, reserve timeline positions, handle images

**Required inputs and returned information.** Domain operations receive: agent/workspace/member identities, user input (text/images), edit requests with revisions, activation payloads, run control signals. They return: validated records, resolved snapshots, timeline/history cursors, terminal statuses, or explicit errors with codes.

**Observable effects.** Domain calls storage operations (create, read, update) and harness execution (Bash commands, file I/O through tools). It decides what to persist, not how. It assembles prompts and calls model providers through Pi AI.

**Failure behavior.** Invalid input, stale revisions, missing records, budget violations, and idleness conflicts fail explicitly with typed errors (`config_conflict`, `workspace_busy`, `member_exists`, etc.). Domain never silently substitutes values or fabricates success. Run failures become terminal run status with error details; persistence failures propagate to callers.

## Subsystems

Each child subsystem has its own design node with full purpose, interface contract, and constraints:

- [Config](config/design.md) — configuration management and provider connections
- [Workspace](workspace/design.md) — workspace registry, context base, file versions, project file API
- [Team](team/design.md) — member lifecycle, group chat, activation, conversation context
- [Harness](harness/design.md) — tool selection, file authority, Bash execution, Git commit approval
- [Agent](agent/design.md) — model–tool loop mechanism, progress buffering, run state
- [Web Tools](web-tools/design.md) — web_search and web_fetch capabilities

## Constraints, specifications and requirements

- Domain imports Foundation and the `Store` interface from Storage. It must never import `MySqlStore` directly or import API.
- Domain declares storage interfaces; Storage implements them; Runtime wires the concrete implementation.
- Domain never contains HTTP routing, status codes, or SSE framing logic. Those belong in API.
- Domain is organized into six subsystems; each child design node owns its implementation files.
- Known violations (see parent backend layering section): `harness.ts` is a 17-module hub resisting single-layer placement; some foundation files still import domain types.
