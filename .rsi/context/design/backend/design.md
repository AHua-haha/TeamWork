# Backend

## Purpose, responsibilities and boundaries

The backend is the Node.js/TypeScript execution engine that runs all AI agents, persists their state, and exposes HTTP/SSE APIs for the frontend. It owns the model–tool loop implementation, MySQL persistence, provider connection management, workspace and team coordination, harness authority, and all domain logic. The backend serves one local user through loopback HTTP; it has no authentication, multi-tenancy, or public exposure.

The backend is structured into five physical layers under `backend/src/`. Each layer owns a category of decisions:

- **Foundation** — pure value types, error codes, serialization, text utilities
- **Storage** — MySQL persistence, transactions, revisions, schema
- **Domain** — use-case rules and capabilities: config, runtime loop, team, harness, workspace
- **Runtime** — process assembly, dependency wiring, lifecycle
- **API** — HTTP transport, routing, validation, SSE framing

Import direction flows inward only: **API → Domain → Foundation**, **API → Runtime → Domain**, **Storage → Foundation**, **Domain → Storage → Foundation**. The composition root (`runtime/main.ts`) is the only file permitted to know every concrete implementation.

## Interface contract

**Purpose and supported interactions.** The backend accepts HTTP requests from the frontend and returns JSON responses or SSE streams. It executes:

- Agent runs: submit user input, follow progress/history, cancel runs
- Config management: connections, models, tools, prompts, agent settings
- Workspace operations: registry, context-base file operations, change feed
- Team operations: member lifecycle, group chat, activation, commit approval
- System lifecycle: startup, shutdown, database ownership

**Required inputs and returned information.** Deployment supplies a MySQL connection URL and encryption key. Editable records include provider connections, catalog options, agent configs, workspace registries, and member definitions. User chat supplies text or image content. Run submissions identify an agent and supply the input. Follow requests identify an agent, optional run, and optional completed-history cursor.

**Observable effects.** The backend writes to MySQL (agents, runs, messages, contexts, config records, workspaces, context versions, members, chat messages and images). It owns one persistent Bash shell per active member. `main.ts` binds the HTTP port and acquires the database ownership lock.

**Failure behavior.** Invalid input returns 4xx with JSON `{error: {code, message}}`. Run failures surface as terminal run status with error detail, never as fabricated answers. Restart marks abandoned runs `interrupted` and preserves committed records. There is no automatic retry or durable run resumption.

## Backend layering

Imports flow inward only: **API → Domain → Foundation**, **API → Runtime → Domain**, **Storage → Foundation**, **Domain → Storage → Foundation**. The composition root (`runtime/main.ts`) is the only place all concrete implementations meet.

| Layer | Directory | What it owns | Must never |
|---|---|---|---|
| **Foundation** | `src/foundation/` | Value types, error codes, serialization contracts, text utilities | Import any other backend layer |
| **Storage** | `src/storage/` | MySQL persistence, revisions, transactions, schema, migration | Make domain decisions; import Domain |
| **Domain** | `src/domain/` | Use-case rules, capabilities, mechanisms: activation, publication, harness authority, model loop, context assembly | Speak HTTP, import API |
| **API** | `src/api/` | HTTP routing, body validation, status codes, SSE framing, `index.ts` public re-exports | Contain policy; import Storage directly |
| **Runtime** | `src/runtime/` | Process assembly, concrete dependency wiring, lifecycle (`main.ts` only) | Contain any business rule |

### Known layering violations (labeled debt)

These exist in the current codebase and are recorded here so members do not silently treat them as intended design.

**Fixed:**
1. ~~`foundation/types.ts` imports `domain/progress.ts`~~ — **Fixed in Phase 2:** `ProgressEvent` type moved into `types.ts`; cycle broken.
2. ~~`runtime.ts` imports concrete `MySqlStore`~~ — **Fixed in Phase 3:** `storage/store.ts` interface extracted; Domain and Runtime depend on the interface; `main.ts` wires concrete `MySqlStore`.

**Remaining:**
3. **`storage/database.ts` imports 8 domain modules** (`chat-images.imageContent`, `chat-images.validateChatImages`, `conversation-context.repairInterruptedTools`, `final-answer.finalAnswer`, `member-response.parseMemberResponse`, `group-chat` validation/types, `workspace-models`, `member-config-format.generatedSource`) — Storage reaching into Domain for deserialization and business logic during reads/recovery. Fix: domain modules register serialization/parsing functions through an interface that storage calls; storage stores and retrieves opaque JSON. Complex refactor; deferred.
4. **`foundation/codec.ts` imports `domain/context-base.ts`** types — Foundation depending on Domain. Fix: move `Author`/`ChangeRecord` type declarations into `foundation/changes.ts`. Low cost; deferred.
5. **`foundation/tool-result.ts` imports `domain/runtime.ts`** — Foundation depending on Domain. Fix: define `ToolOutput` against a Foundation-local interface. Low cost; deferred.
6. **`domain/workspace-reset.ts` accesses `store.pool` directly** — bypassing the storage interface for transaction scoping. Retained as acceptable given workspace reset's special requirements.
7. **`domain/harness.ts` is a 17-module hub** spanning design, member files, git approval, bash, web tools — harness is a cross-cutting authority service that resists single-layer placement. Fix: split into `harness-authority` (domain) and `harness-execution` (runtime). Deferred.

## Constraints, specifications and requirements

- Node.js 22.19+, TypeScript 5.7+, MySQL 8.4
- Pi AI `@earendil-works/pi-ai` 0.87.1 as the message/tool/provider format
- One backend process per database, enforced by exclusive session lock
- No multi-user authentication, multi-tenancy, or public network exposure
- Prototype limits: no workspace rename/deletion, no automatic compaction, no history pagination

## Subsystems

Each child layer has its own design node with full interface contract and constraints.

- [Foundation](foundation/design.md) — innermost shared layer: pure types, error codes, serialization, text utilities
- [Storage](storage/design.md) — MySQL persistence, transactions, revisions, schema
- [Domain](domain/design.md) — use-case rules and capabilities (to be further split)
- [API](api/design.md) — HTTP transport, routing, SSE framing, composition root
- [Runtime](runtime/design.md) — process assembly, lifecycle, concrete wiring
