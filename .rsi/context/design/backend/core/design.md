# Core

## Purpose, responsibilities and boundaries

Core aggregates the actual agent-system logic. It owns workspace/design/context handling, team/member configuration and cooperation, group chat and member context construction, the agent model/tool loop, harness/tools/permissions, provider/model configuration and application settings. Internal decomposition is deferred.

Core completely owns its data model: runtime memory, serialization, SQL tables/keys/indexes, queries, validation, schema/data migrations and concurrency rules. Its persistence code is part of Core and uses Storage's technical resources. Other systems interact through Core interfaces rather than knowing its records or querying its tables.

## Interface contract

Core accepts validated-shape requests for agent/workspace/configuration/team/chat and execution control. It checks semantic validity, revisions, admission and authority; returns public records, asynchronous run identities, consistent read results, ordered history/progress and explicit errors. Existing callable behavior is retained.

It performs atomic business updates, including group publication/reservations and member activation, through transactions it owns. Member activation remains separate from commit and requires the entire workspace idle. Shared group context and private working history remain distinct. Completed messages are durable and immutable relative to mutable model context; compact progress is memory-only. Recoverable tool failures return tool results and allow the loop to continue.

Working design roots include all accepted descendant designs recursively; dependencies remain exact. Harness enforcement defaults enabled and may be disabled by the operator startup setting. Disabled mode removes file/tool role/sandbox/explicit Git gates, with ordinary OS authority; input validation, timeout/cancellation and member activation retain their rules. No automatic Git checkpoints or member worktrees are introduced.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
