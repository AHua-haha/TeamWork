# Operations

## Purpose, responsibilities and boundaries

Operations owns development/deployment build and process management, launch configuration and supporting database service lifecycle. Backend Core owns application records/schema; Storage owns application access to the database service. Operations does not interpret business records.

## Interface contract

Project commands manage development and committed host deployment using one private rsi.config.json. The existing MySQL service is shared by independent development/deployment databases/accounts/keys. Commands keep settings in child processes, preserve caller/global environment and refuse unrelated occupied ports/processes.

Deployment builds an exported local commit before switching app processes, preserves the current version on build failure and attempts recovery on launch failure. Stopping an app preserves the database service/data. Existing old compiled release entries remain startable for recovery after source migration. No data reset/copy, infrastructure rewrite or live deployment update is part of source reorganization.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
