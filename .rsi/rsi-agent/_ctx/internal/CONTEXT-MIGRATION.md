# Context migration record

The project now uses `.rsi/rsi-agent/` and mirrors real project paths. A design part owns `_ctx/`, or `<file-name>.ctx/` for a source file. Only design parts have context directories; their nearest enclosing design part maintains information about other nodes. `DESIGN.md` is the user design. Optional `README.md` is a concrete usage contract. Internal-context structure remains deferred.

## Preserved knowledge

All 91 original context files have explicit destinations in `context-migration.json`. Old implementation READMEs are preserved as `internal/legacy/implementation-notes.md`, with their supporting reference documents. They are historical development context, not automatically current usage contracts. Links to relocated or existing source targets were adjusted. Original design-mapping metadata is retained as internal legacy metadata rather than a new-format design identifier.

Six usage contracts were extracted where clear consumer-facing material existed: Project, API, Storage, React Harness, Operations and Desktop. Other design parts may omit README. Some historical implementation notes contain superseded statements; those were not promoted as new promises.

## Ownership mapping

Core parts are under `backend/src/core/`, and API, Storage and Runtime follow their actual source directories. Frontend parts follow `frontend/src/`. Operations is represented at `scripts/`; its design also references backend build scripts and configuration responsibilities. Shared UI is at its actual `frontend/src/shared/ui/` location, correcting its old metadata path.

The retired Harness has no current implementation directory and is retained under project internal legacy context rather than recreated as a design part. Its historical assignment alias points to React Harness, its successor. Other legacy member references map explicitly to their moved design documents. Member identities, active SQL snapshots, message/context history, accepted configuration bundles and activation rules are not rewritten by this migration. Prompt file links were updated through the ordinary reviewable file changes.

## Runtime compatibility

New projects initialize only root DESIGN and lead configuration. Existing project context is preserved during adoption and stays recognizable after checkout-directory renames. Existing legacy workspaces keep their old format until explicitly migrated. A migrated workspace can resolve its old active references using the explicit local migration map. Previously accepted baseline bytes are re-keyed, not replaced with pending current content. Context file indexing continues to preserve old revisions; original Agent and Team message history is untouched. Internal context is not auto-executed.

No application database reset, deployment, Git commit or member activation is performed by this migration task.

## Verification

267 backend unit/HTTP tests and 98 disposable-MySQL integration tests passed; the backend production build passed. Focused migration coverage checks optional contracts, file/directory parts, recursive scope boundaries, cleanup consent and rollback, renamed checkouts, explicit aliases, accepted-versus-pending bytes, and reopening with durable prior context revisions and unchanged member records. No application database was used for these tests. Historical reference notes retain previously obsolete source references as internal knowledge; they are not promoted into current contracts.
