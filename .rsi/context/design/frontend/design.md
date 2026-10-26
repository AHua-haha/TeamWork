# Frontend

## Purpose, responsibilities and boundaries

Frontend owns browser interaction and presentation for the local agent application. It turns user actions into backend requests and presents backend records, live progress, forms and explicit outcomes. Backend remains authoritative for durable state, validity and effects.

## Architecture

The frontend is divided into three top-level layers:

- **App** owns startup, route assembly, the application shell and global navigation.
- **Shared** owns reusable presentation components and one public backend client. The client provides transport and parses protocol responses into API representations; it does not implement feature workflows or feature-specific data interpretation.
- **Features** own user-facing workflows, state and feature-specific composition. Features use App-provided navigation composition, Shared UI and the shared backend client.

See the child designs for [App](app/design.md), [Shared](shared/design.md) and [Features](features/design.md).

## Initial information architecture

Keep the initial global navigation simple, with four destinations:

1. **Home** — landing page, workspace overview/list and quick actions.
2. **Providers** — provider connections, credentials and model configuration.
3. **Chat** — conversation, composer, history and live progress.
4. **Workspace** — selected-workspace information presented as tabs. Its initial sections may include Overview, Files, Design, Team/Members, Changes, Settings and Context; these are not additional top-level destinations. The Context tab shows either group or member context, selected from a left-side source list.

The four feature designs are [Home](features/home/design.md), [Providers](features/providers/design.md), [Chat](features/chat/design.md) and [Workspace](features/workspace/design.md).

This is an information-architecture decision. Exact route paths and whether Chat is entered with an explicitly selected workspace remain to be aligned with the existing interaction flow; do not infer a new API or lifecycle contract from the navigation structure.

## Observable behavior and constraints

The browser consumes backend JSON, binary images and SSE protocols and submits user actions with required identities, revisions and cursors. It displays completed stable history plus transient deltas, recovers gaps/reconnects using completed records, and does not inspect running-agent objects. Final responses, folded private work, tool output and thinking activity retain their current behavior.

Rejected submissions preserve editable user input where currently supported. Client disconnect/navigation does not itself cancel backend work. Review decisions and member activation remain explicit user actions.

### Workspace initialization review

Before creating a workspace, inspect the selected directory. When nonempty `.rsi` state outside context exists, show its paths and an explicit Clean up and initialize action. State that project context and source are preserved and other member/runtime metadata is discarded. Cancel performs no cleanup or registration. Submit the reviewed cleanup revision with the captured creation request; if state changes, show the conflict and require a new review. No cleanup confirmation is needed for context-only or empty managed state.

## Constraints

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees.
- Refusals and failures remain explicit. Backend owns business validation and durable effects.
- This document is the frontend overview; child designs define layer and feature responsibilities.
