## Result summary

Inspected accepted Harness design and all current files mapped to it. Harness resolves design assignment scopes into file access, constructs member tools/prompts, executes persistent Bash sessions and mediates explicit Git commits. This documents current implementation without touching source; no tests run.

## File lookup

| Path | Description |
|---|---|
| `backend/src/domain/harness/harness.ts` | Design resolution, permission mapping and HarnessService. |
| `backend/src/domain/harness/harness-config.ts` | Member harness configuration parsing/types. |
| `backend/src/domain/harness/harness-resources.ts` | Resource ownership rules and tool definitions. |
| `backend/src/domain/harness/harness-bases.ts` | Purpose/inspection harness bases. |
| `backend/src/domain/harness/harness-prompts.ts` | Prompt loading and interpolation. |
| `backend/src/domain/harness/harness-tools.ts` | File/Bash tool definitions. |
| `backend/src/domain/harness/harness-command.ts` | Persistent Bash session and input execution. |
| `backend/src/domain/harness/harness-execution.ts` | Execution resources lifecycle. |
| `backend/src/domain/harness/git-approval.ts` | Explicit commit approval workflow. |
| `.rsi/context/design/backend/domain/harness/design.md` | Accepted subsystem design. |

## Implemented contract

`harnessConfig(value)` parses a member's design scope and command metadata. `resolveHarness(designs, workspaceId, config)` resolves working and dependency nodes; `harnessPermissions(member, resolved)` returns separate design-context, implementation-context and source permission paths; `harnessAccess` builds the file gate. `HarnessService` is constructed with workspace/root/member and collaborators, resolves available harness definitions and authorizes/dispatches tools. Inputs are identities, assignment config and tool requests; outputs include resolved scopes, tool results and permission refusals. Effects are delegated file operations, process execution and approval state.

`parseBashInput` accepts `{command,cwd?,timeout?,background?,metadata?}` and validates fields. `executeBash` uses persistent per-member shell sessions; default timeout is 60 seconds and output retention cap 50 KiB. Background jobs can continue beyond the call; reset/close functions stop sessions. Bash is intentionally broader than built-in file-tool permissions. `allowedCommands` is configuration metadata and is not an execution allowlist. `GitApprovals` handles explicit git commit requests with accept/deny/feedback decisions; mixed design/member plus implementation commits are refused by mediation policy. Example: use built-in `write` for mapped files; use Bash for broader operations while following work-scope instructions; issue explicit `git commit` only for authorized candidate.

## Implementation notes

Prompts and definitions are composed from harness bases/resources. Git approval mediates explicit commits only, not arbitrary scripts that invoke Git indirectly. Commit hooks are disabled in mediated execution per design. Exact authorization results and lifecycle are in HarnessService and execution helpers.

## Verification and continuation

Inspected exported declarations and current modules; tests/build not run. Open: validate actual permission edge cases against harness tests and inspect caller lifecycle for session cleanup and approval cancellation/restart.

## Automatic retrieval

```json
{"commands":[]}
```
