# Project usage contract

**Input:** User text/images, project directories, model settings, revisions/cursors, review/activation decisions and operator launch settings.

**Output:** Observable application records, streamed progress, tool effects, project file changes and explicit errors.

**Effect and failure:** Core owns durable business changes and external effects. Operations owns process lifetimes, separate development/deployment accounts and source snapshots.

**Usage example:** Run `./scripts/dev.sh start` after installing locked dependencies. Open the configured frontend, register a workspace and send a team message. See the package READMEs for current HTTP and operational examples.
