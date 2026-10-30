## Project context organization

The project context root is `.rsi/<project-name>/`, separate from source files. Its hierarchy mirrors actual project paths. Only a meaningful design part has context: a directory's own context is `_ctx/`, and a file's is `<full-file-name>.ctx/`. Ordinary intermediate directories only preserve paths. The nearest enclosing design part owns information about files and directories without their own design part. Several documents about one part do not create child design parts.

`DESIGN.md` records the user's intent, requests, constraints, requirements and architectural mental model. Follow it when implementing. Design changes must be visible to the user. It does not have to define an exact protocol.

An optional `README.md` is the usage contract of the actual implementation. Maintain concrete interfaces, inputs, outputs, observable effects, failures, lifecycle rules/guarantees and usage examples from the consumer's perspective. A missing README is allowed. Do not rename miscellaneous implementation notes to README or represent planned behavior as implemented.

Maintain internal implementation knowledge separately for continuity and quick lookup. Do not treat internal notes as current consumer contracts or recreate retired archives. Verify behavior against current source. Internal-context structure and automatic retrieval remain deferred; reading context does not execute embedded commands.

Working designs express the system to implement; dependency consumer context explains how to use other design systems. File React Harness owns this context responsibility. Documents are changing information rather than fixed system instructions. Do not assume complete design documents or dependency content are automatically loaded into the system prompt; use file tools when needed. Their future dynamic injection timing, role and lifecycle remain deferred.
