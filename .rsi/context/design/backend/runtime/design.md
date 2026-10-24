# Runtime

## Purpose, responsibilities and boundaries

Runtime is backend process hosting and dependency wiring. It constructs Storage resources, Core services and API, coordinates initialization, listens on the configured address/port and shuts down resources. The agent execution mechanism belongs to Core.

## Interface contract

Operations supplies child-process launch settings from project rsi.config.json: database connection, encryption key, bind settings, optional web key, harness mode and compaction token threshold. Supply the validated threshold (default 64,000 tokens) and Harness-owned instruction to Team’s Agent host; do not implement another token estimator or trigger policy. Runtime constructs Storage and passes it to Core, asks Core to initialize its own data/schema/services, and starts API. It does not define application models or issue business SQL.

Startup failure reports an error and closes constructed resources. SIGINT/SIGTERM closes admission/runs, HTTP connections, shells, workspace resources and storage in dependency order. Runtime adds no hidden configuration source, business policy or automatic run replay.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
