# Backend boundaries and RSI context migration

Status: complete
Task start commit: b3daf6767b1ecaeb87da55eb316831d1303ea5a2
Review boundaries: Project, Frontend, Backend/Core/API/Storage/Runtime and Operations in .rsi context.

## Delivered outcomes

1. Wrote the agreed eight high-level design drafts before source edits; promoted them with matching implementation contexts and metadata source mappings.
2. Migrated stable source to backend/src/core, api, storage and runtime. Core owns application models, memory/durable formats, SQL, schema/data migrations and invariants. MySqlStorage supplies only engine resources and generic transactions; CoreData receives that resource. API owns transport/multipart; Runtime hosts/wires the process. The agent loop remains Core-owned.
3. Updated imports, tests, prompt assets, reset CLI and managed source/compiled launch entries. Preserved old compiled release restart/recovery support explicitly in Operations.
4. Made .rsi/context/design and .rsi/context/implement the only maintained project context; updated root protocol/instructions and package entry guides. Preserved existing detailed behavior references under aggregate implementation context; retired docs. Historical task evidence remains in Git at the starting SHA (see migration.md).
5. Kept Core aggregated. Its internal design is the next discussion, not an outcome of this migration.

## Decisions and safeguards

Worked from codex/lead-harness at the recorded SHA, without importing either experimental branch. Preserved public HTTP/SSE behavior, application SQL schema/record formats, recursive accepted design scopes, model-call defaults and configurable harness enforcement. No live settings, user databases, deployments or member activation were changed. Existing untracked .claude and Finder metadata remain untouched. Created only RSI context/task records, not a workspace/member registration.

A dedicated MySqlStorage lifetime is injected into each CoreData instance. Core owns business conflict mapping and the database runtime lease. It releases the lease before closing its resource. This avoids moving any business-schema knowledge into technical Storage.

## Verification

Every command and starting SHA is in tests.jsonl. Passed: backend type check/build; 191 backend unit/HTTP tests; 66 disposable MySQL integration tests; 14 isolated host lifecycle/config/frontend-host tests; frontend build; RSI context/source mapping/Markdown link checks and source/compiled startup/assets. Engine integration covers caller-owned schema, commit/rollback, original engine/callback errors and idempotent shutdown. Boundary regression checks prevent Core depending on API/Runtime and Storage depending on business code. The legacy selected compiled release can restart after source migration.

The frontend build retains its existing >500 kB bundle warning. No browser UI behavior changed and no paid model-provider or live deployment test was needed. No runtime-data transformation is introduced by the source move.

## Checkpoint and next work

This task is committed as one consistent checkpoint, identified by Task-ID in Git. Review the high-level context and moved source on codex/lead-harness. Next: discuss the design inside Core before further decomposition. No unresolved behavioral choice remains for this migration. Deployment update/restart is a separate operator action.
