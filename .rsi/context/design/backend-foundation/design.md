# Backend Foundation

## Purpose, responsibilities and boundaries

Backend Foundation is the innermost shared layer of the backend. It owns pure value types, error taxonomy, serialization contracts, and stateless text utilities that every other backend layer depends on. Foundation has no I/O, no domain rules, no database connections, and no network calls. Every other backend layer may import Foundation; Foundation imports nothing from any other backend layer.

## Interface contract

**Value types and error taxonomy.** Foundation defines the shared types that flow through every other layer:

- `AppError` with a code, message and HTTP status — the standard error shape for all backend operations.
- `ContextEntry` and `ContextHistory` — the storage-neutral wrapper around a Pi AI `Message` with runtime metadata and revision.
- `RunState`, `RunStatus`, `RunPhase` — the canonical state enum values used by the runtime, storage, and follow protocol.
- `CompletedMessage`, `CurrentState`, `FollowEvent`, `FollowSnapshot` — the record shapes presented to the frontend.
- `ProgressEvent` and the `Changes` notification bus — compact in-process events for the progress FIFO.
- Identity validators: `identity()`, `position()`, `messageId()` — pure validation functions used to reject malformed IDs before any I/O.

**Serialization contract.** `codec.ts` owns the Pi AI message serialization boundary: `encode`, `decode`, `validateEntries`, `validateMessage`, `validateRun`, `validateAuthor`, `validateChangeRecord`. The storage layer calls these at the database boundary; nothing is written or read without passing through them. Author types (`user`, `external`, `lead`/`memberId`/`runId`) are validated here.

**Text utilities.** `text.ts` exposes pure string helpers used by the domain for path manipulation and prose formatting. `tool-result.ts` exposes `ToolOutput` and `toolText` — the standard output shape for custom runtime tools.

**Change records.** `changes.ts` defines `ChangeRecord` and the `Changes` notification bus, the in-process pub/sub used by the context base to notify followers of committed changes.

## Constraints, specifications and requirements

- Foundation imports only from `@earendil-works/pi-ai` and Node built-ins. No backend sibling import is allowed at this layer.
- Known violations (labeled debt):
  - `foundation/types.ts` imports `ProgressEvent` from `domain/progress.ts` — a cycle that inverts the intended direction. Fix: move the `ProgressEvent` type declaration into `types.ts`; `progress.ts` then only imports from Foundation.
  - `foundation/codec.ts` imports `Author` and `ChangeRecord` types from `domain/context-base.ts`. Fix: move those type declarations into Foundation or into `changes.ts`.
  - `foundation/tool-result.ts` imports `RuntimeTool` from `domain/runtime.ts`. Fix: define `ToolOutput` in terms of a Foundation-local interface rather than the full `RuntimeTool`.
- Pi AI message format is pinned at `@earendil-works/pi-ai` 0.87.1. Unknown content-block kinds, cycles, bigint, class instances, nonfinite numbers and functions fail serialization explicitly.
