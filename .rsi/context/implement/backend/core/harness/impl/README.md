# Retired Harness implementation context

## Result summary

The separate Harness implementation is removed. File and Default React Harnesses belong to Agent. See [Agent implementation context](../../agent/impl/README.md). Team owns configuration review and assignment guidance; Workspace owns bootstrap templates. This node remains only for existing design/member references.

## Implemented contract

There are no tools, permissions, sandbox policies, Git approvals or public APIs owned here. Existing member assignment fields and historical SQL state identifiers remain passive compatibility data. No workspace, context or stable history reset is part of the refactor.

## File lookup

- `backend/src/core/agent/react-harness.ts`: fallback execution and capability assembly.
- `backend/src/core/agent/file-react-harness.ts`: file tools and aggregate state.
- `backend/src/core/agent/tools/`: ordinary search, Bash and web executors.
- `backend/src/core/team/member-workspace.ts`: accepted assignment guidance and configuration review.

## Automatic retrieval

```json
{"commands": []}
```
