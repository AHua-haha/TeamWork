# Frontend

## Purpose, responsibilities and boundaries

Frontend owns browser interaction and presentation for the local agent application: navigation, chat/composer, streaming output, member/design inspection, provider/model configuration and review/activation controls. Backend remains the authority for durable state, validity and effects.

## Interface contract

The browser consumes backend JSON, binary images and SSE protocols and submits user actions with the required identities/revisions. It displays completed stable history plus transient deltas; it recovers gaps/reconnects using completed records and does not inspect running-agent objects. Final responses, folded private work, tool output and thinking activity retain their current behavior.

The UI returns visible records, forms, progress and explicit error/retry states. Rejected submissions preserve editable user input where currently supported. Client disconnect/navigation does not itself cancel an agent. Review decisions and member activation remain explicit separate user actions.

### Workspace initialization review

Before creating a workspace, inspect the selected directory. When nonempty `.rsi` state outside context exists, show its paths and an explicit Clean up and initialize action. State that project context and source are preserved and other member/runtime metadata is discarded. Cancel performs no cleanup or registration. Submit the reviewed cleanup revision with the captured creation request; if state changes, show the conflict and require a new review. No cleanup confirmation is needed for context-only or empty managed state.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
