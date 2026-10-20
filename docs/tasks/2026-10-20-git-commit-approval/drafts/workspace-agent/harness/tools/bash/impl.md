<!-- Task proposal; current contract is under docs/systems/ -->
# Bash Git approval integration proposal

## Contract

[Bash](design.md) preserves the persistent shell/resource/output contract and replaces scoped Git with explicit commit permission checks. Not yet implemented.

## Responsibilities and decomposition

Keep shell state, jobs, descriptor handling and sandbox policy. Replace invocation-scoped Git routing with explicit-commit detection and backend-owned candidate/approval coordination; no mediation of unrelated Git operations.

## Coordination and data flow

Explicit candidate inspection precedes commit execution. Allow implementation-only, refuse mixed, or await user decision for protected-only. Refusal/feedback resolves as a tool result. Acceptance rechecks exact contents. The shell must retain established state while waiting without accidentally replaying earlier script effects. Supported compound forms and background approval behavior require a concrete design before coding.

## Decisions and constraints

No script/program introspection or complete security guarantee. Do not preserve git.scope metadata, scoped command allowlists or private staging/history. Keep timeout defaults for actual foreground/background execution; specify waiting-user lifecycle separately.

## Code map

Existing backend/src/harness-command.ts, harness-tools.ts and harness.ts; current per-invocation Git bridge is a replacement target.

## Verification

Future tests exercise candidate options, foreground shell continuity, approved execution exactly once, cancellation, stale approval, mixed refusal and ordinary Git behavior. Existing persistent-shell and sandbox tests remain relevant.
