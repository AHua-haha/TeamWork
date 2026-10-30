# Project implementation context

## Result summary

The stable branch is reorganized into Frontend, Backend and Operations. Backend delegates to aggregate Core, API, Storage and Runtime. No internal Core design split is introduced.

Design: [Project](../../DESIGN.md).

### Coordination and ownership

Use the browser for workspace/team conversations, review, provider settings and member inspection. Operations launches the application; API carries requests to Core; Core owns business effects and uses Storage for engine access. Browser clients never query SQL directly.

### Implemented contract

**Input:** User text/images, project directories, model settings, revisions/cursors, review/activation decisions and operator launch settings.

**Output:** Observable application records, streamed progress, tool effects, project file changes and explicit errors.

**Effect and failure:** Core owns durable business changes and external effects. Operations owns process lifetimes, separate development/deployment accounts and source snapshots.

**Usage example:** Run `./scripts/dev.sh start` after installing locked dependencies. Open the configured frontend, register a workspace and send a team message. See the package READMEs for current HTTP and operational examples.

## File lookup

- [frontend](../../../frontend/_ctx/internal/legacy/implementation-notes.md): child implementation context.
- [backend](../../../backend/_ctx/internal/legacy/implementation-notes.md): child implementation context.
- [operations](../../../scripts/_ctx/internal/legacy/implementation-notes.md): child implementation context.

## Automatic retrieval

```json
{"commands": []}
```
