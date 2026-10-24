# Business-owned data models

## Status

Complete in the accompanying Task-ID commit. The agreed design and implementation are delivered.

## Provenance and safeguards

- Starting commit: 77cbe0b49112dac61020f1ce36ce8ffa66265f96. Branch: codex/lead-harness.
- Preserve unrelated .gitignore edits. No live database, workspace, private configuration, provider, deployment, merge or push operations. Verify with deterministic providers and disposable databases.
- Boundaries: Core and its Agent, Team, Workspace, Harness children; Runtime/API composition; Storage infrastructure remains business-neutral.

## Agreed outcome

Each business aggregates its core in-memory schema, durable model and related data operations into its own data-model part. Agent owns and implements persistence of context, execution state, completed private history and compaction lifecycle; Team no longer owns those tables or writes. Team owns membership/configuration/shared-chat data. Workspace owns registry/models/context files and history. Harness groups its configuration/scope/approval models and retains process-local execution resources.

Core coordinates cross-owner atomic workflows through public transaction-scoped operations, never by copying foreign schemas/queries. Preserve atomic publication/reservations, workspace+lead bootstrap, member activation, reset, recovery, runtime ownership and HTTP/SSE contracts. Storage still supplies generic engine resources/transactions only. No new design child nodes or data reset.

## Plan

1. Draft ownership/interface contracts and implementation plan before source edits.
2. Replace monolithic TeamData with owner data-model parts and explicit Core composition; migrate consumers and data definitions.
3. Preserve existing durable schemas/envelopes and behavior, add ownership and transactional failure checks.
4. Reconcile canonical context/process ownership guidance; verify exact candidate and commit with Task-ID.

## Delivered implementation

- Every Core business has a cohesive data/ part. Agent owns model/state/context/progress/validation, schemas and AgentData persistence plus AgentRuntime. Team owns members/configuration/shared chat, SQL and transient TeamExecutionData. Workspace owns registry/model/context/file/history/baseline models and WorkspaceData persistence. Harness aggregates scope/resource/Bash/approval models and related operations; Git execution consumes ApprovalRequests without owning its state.
- Removed the old monolithic TeamData and the Team-owned runtime host. CoreData exposes owner instances and coordinates only lifecycle/public callbacks; it contains no business SQL/schema or CRUD forwarding facade. AgentRuntime has no concrete Team/Harness/Workspace dependency and can use AgentData with only Agent tables.
- Shared transactions bind owner operations through inTransaction(connection), retaining atomic bootstrap/publication/admission/activation/terminal presentation/reset and lock order. Core/schema-neutral mechanics do not interpret foreign business models. Existing durable table/JSON formats and public HTTP/SSE behavior are preserved; no user data migration/reset is needed for the source split.
- Team coordination reads only {id,historyPosition,activeRunId}; snapshot/stop use Agent batch reads to avoid per-run query growth. Legacy-context adoption is skipped for already migrated Agent records. Workspace baseline import now receives an accepted-member-files map rather than casting its store to TeamStore.
- Canonical design/implementation context, source links, standing ownership guidance, API composition, administrative script and backend usage examples were reconciled. The RSI tree retains the same 12 design nodes; data/ is an internal implementation boundary.

## Verification

Final checks pass: 210 backend unit/HTTP tests, 75 disposable MySQL integration tests, 87 frontend tests, 15 isolated host-script tests, backend type check/build, frontend build and RSI document/source/link/packaged-startup validation. Full starting SHA and every check result, including failures, are recorded in tests.jsonl. verify-context.mts and check.py make the context check/logging reproducible.

Existing SQL tests cover bootstrap and publication rollback, immutable history/context separation, member/model activation, reset, sender-origin references, leases, failure/cancellation, compaction and restart. New ownership checks reject foreign-table queries and SQL in Core composition/Storage, prove Agent runs/restores independently of Team/Workspace tables and that shared owner operations roll back together. TeamExecutionData checks protect finalizing jobs and successor admission identity. No live providers, shared application databases, registered workspaces or deployments were changed.

Earlier failures remain in tests.jsonl: inline source paths/one duplicate validator import needed migration corrections; tests still bound monkeypatched methods to the removed store; the old architecture gate forbade Agent persistence and its initial replacement mistook ON DUPLICATE KEY UPDATE column assignments for tables. The context-check copy also needed its moved .js import updated. Corrected source/imports/hooks and ownership rules; did not weaken behavioral assertions or introduce compatibility fallbacks. Later full suites pass. Final whitespace validation found and removed an extra blank line left by the common-codec export cleanup.

## Handoff and limits

Restart the backend to use the new module graph. Existing rows/envelopes, environment configuration, model/tool behavior and frontend contracts remain. Harness approvals/jobs remain process-local as before. Database transactions cannot roll back filesystem/tool effects; existing uncertainty/recovery behavior remains. The frontend build retains its existing large-chunk advisory. Unrelated .gitignore edits are excluded. No push, merge, data reset or deployment was requested/performed.
