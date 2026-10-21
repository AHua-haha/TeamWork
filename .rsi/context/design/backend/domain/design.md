# Backend Domain

## Purpose, responsibilities and boundaries

Backend Domain owns all use-case logic, capabilities, and mechanisms. This is where every interesting rule in the backend lives. Domain decides *what can happen* and *when it's allowed*: activation must be atomic and idle, publication must validate mention budget, reset requires idleness, context assembly follows specific precedence, harness authority maps file scopes to permissions.

Domain includes the agent runtime loop mechanism (how requests are constructed, tools dispatched, continuation decided), configuration management (validation, resolution, snapshots), workspace operations (registry, file API, context base), team coordination (member lifecycle, activation, routing, group chat transcript), harness (tool authority, prompt composition, commit approval), and conversation context assembly.

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

## Current domain modules

Domain currently contains 41 files organized by feature, not yet further split into subdirectories:

**Config & providers:**
- `config.ts`, `secrets.ts`, `providers.ts`, `providers/modelflare.ts`, `providers/modelflare-catalog.ts`

**Runtime & progress:**
- `runtime.ts` (model loop mechanism), `progress.ts` (FIFO events)

**Workspace & context:**
- `workspace.ts`, `workspace-bootstrap.ts`, `workspace-layout.ts`, `workspace-models.ts`, `workspace-reset.ts`, `workspace-git.ts`
- `context-base.ts`, `context-documents.ts`, `context-path.ts`, `design.ts`
- `project-files.ts`

**Team & chat:**
- `team.ts`, `team-system.ts`, `team-runner.ts`
- `group-chat.ts`, `chat-images.ts`, `final-answer.ts`
- `conversation-context.ts`

**Members:**
- `member-config.ts`, `member-config-format.ts`, `member-files.ts`, `member-instructions.ts`, `member-response.ts`, `member-tools.ts`

**Harness:**
- `harness.ts` (hub), `harness-config.ts`, `harness-prompts.ts`, `harness-bases.ts`, `harness-tools.ts`, `harness-execution.ts`, `harness-command.ts`, `harness-resources.ts`, `git-approval.ts`

**Web tools:**
- `web-tools.ts`

Plus `backend/README.md` and `backend/.env.example`.

## Constraints, specifications and requirements

- Domain imports Foundation and the `Store` interface from Storage. It must never import `MySqlStore` directly or import API.
- Domain declares storage interfaces; Storage implements them; Runtime wires the concrete implementation.
- Domain never contains HTTP routing, status codes, or SSE framing logic. Those belong in API.
- **Further splitting planned:** The user intends to decompose domain into subdirectories (`domain/config/`, `domain/workspace/`, `domain/team/`, `domain/harness/`, `domain/agent/`) in a subsequent design pass. This current node consolidates all 41 domain files as the baseline before that split.
- Known violations (see parent backend layering section): `harness.ts` is a 17-module hub resisting single-layer placement; some foundation files still import domain types.
