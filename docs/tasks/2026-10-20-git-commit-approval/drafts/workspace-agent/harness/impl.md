<!-- Task proposal; current contract is under docs/systems/ -->
# Harness implementation proposal

## Contract

[Harness](design.md) defines the target. This is an implementation plan, not implemented behavior.

## Responsibilities and decomposition

HarnessService retains purpose composition, accepted-assignment file invocation checks and prompts. The persistent Bash integration gains explicit-commit detection and a candidate permission/approval boundary. Ordinary Git owns all repository history. Remove HarnessHistory private Git ownership and ProjectGit scope command mediation rather than adapting their scope model into the new flow. Bash sandbox and other native tool behavior remain.

## Coordination and data flow

Detect an explicit commit request, determine repository and actual candidate changes, classify paths, then execute/refuse/wait for the user. Pending approval links the tool request to an immutable reviewed candidate; resolution returns one tool result or executes the reviewed commit. The frontend reads backend approval state and submits user decisions. The review panel reads the same candidate as the approval control.

Remove run-end/pre-publication/interruption checkpoint callbacks, scope inspection/history/restore/commit APIs and git.scope broker semantics. Preserve the general runtime lifecycle and workspace execution exclusion where still needed. Replace accepted-design lookup, member committed-source/activation comparison and bootstrap/member materialization dependencies before removing the private store. Reconcile their canonical contracts together with implementation. Existing context SQL file versions and private message persistence are separate systems and remain.

## Decisions and constraints

No implementation changes in this design task. Unknown-path policy, rename classification, command syntax/repository resolution, waiting/cancellation/restart, acceptance/activation sourcing and migration need concrete follow-up before implementation. Do not delete current .rsi/harness or convert stored data during discussion. Approval storage does not reintroduce private Git indexes/references or checkpoints.

## Code map

Current change points: backend/src/harness.ts, harness-history.ts, project-git.ts, harness-command.ts, harness-bases.ts, harness-config.ts, workspace-bootstrap.ts, member-config.ts, design.ts, team runner/publication and runtime lifecycle; frontend group composer and right-panel review. These are existing code locations to revise, not claims of a completed implementation.

## Verification

Future tests cover staged-versus-dirty candidate classification; direct/mixed/protected commits; user decisions and stale contents; no run checkpoints; normal history/index preservation; separate idle member activation; durable conversation context; frontend popup/review separation and migration without file loss. Design persistence checks in this task verify draft markers and local design links only.
