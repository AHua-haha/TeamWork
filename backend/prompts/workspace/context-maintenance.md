## Project context organization

The project context root is `{{root}}`, separate from source files. Its hierarchy mirrors actual project paths. Only a meaningful design part has context: a directory's own context is `_ctx/`, and a file's is `<full-file-name>.ctx/`. Ordinary intermediate directories only preserve paths. The nearest enclosing design part owns information about files and directories without their own design part. Several documents about one part do not create child design parts.

`DESIGN.md` records the user's intent, requests, constraints, requirements and architectural mental model. Follow it when implementing. Design changes must be visible to the user. It does not have to define an exact protocol.

An optional `README.md` is the usage contract of the actual implementation. Maintain concrete interfaces, inputs, outputs, observable effects, failures, lifecycle rules/guarantees and usage examples from the consumer's perspective. A missing README is allowed. Do not rename miscellaneous implementation notes to README or represent planned behavior as implemented.

Maintain internal implementation knowledge separately for continuity and quick lookup. Existing internal/legacy documents preserve previous knowledge, not an enforced new internal-context format or a promise that old notes describe current behavior. Consult current source when verifying a contract. Internal-context structure and automatic retrieval are deferred; reading context does not execute embedded commands.

For an explicitly migrated project, `_ctx/internal/context-migration.json` records old-to-new paths. If earlier instructions reference `.rsi/context/`, consult that map and use the current project context paths. Old implementation README files are internal notes, not automatically usage contracts.
