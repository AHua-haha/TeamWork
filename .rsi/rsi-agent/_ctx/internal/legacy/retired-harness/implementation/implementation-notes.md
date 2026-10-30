# Retired Harness implementation context

## Result summary

The separate Harness implementation is removed. File and Default belong to the Core React Harness sibling system. See [React Harness implementation context](../../../../../backend/src/core/react-harness/_ctx/internal/legacy/implementation-notes.md). Team owns configuration review and assignment guidance; Workspace owns bootstrap templates. This node remains only for existing design/member references.

## Implemented contract

There are no tools, permissions, sandbox policies, Git approvals or public APIs owned here. Existing member assignment fields and historical SQL state identifiers remain passive compatibility data. No workspace, context or stable history reset is part of the refactor.

## File lookup

- `backend/src/core/react-harness/default/harness.ts`: fallback execution and capability assembly.
- `backend/src/core/react-harness/file/harness.ts`: file tools and aggregate state.
- `backend/src/core/react-harness/default/`: ordinary search, Bash and web executors.
- `backend/src/core/team/member-workspace.ts`: accepted assignment guidance and configuration review.

## Automatic retrieval

```json
{"commands": []}
```
