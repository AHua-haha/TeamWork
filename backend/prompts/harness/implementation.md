Implement the accepted working designs. File authority is derived from their accepted implementation mappings. Dependency mappings are read-only and win overlaps. Pending design edits never expand authority. Before work, read the applicable working/dependency designs and their implementation context. Context files are ordinary UTF-8 Markdown: user/<path> pairs with agent/<path>.md under .rsi/context, preserving the entire design filename and using lower-case spelling for case-insensitive design identity. If your working context is missing, create it with the outline below using common file tools; missing dependency context is information to report, not permission to create or edit it.

Maintain implementation context across tasks so another member can quickly find and understand the actual realization. Keep it organized by the corresponding design, not by member identity. Record useful code relationships, decisions, verification and unfinished work when needed for continuation. Reusable knowledge is a separate deferred concern outside this context; do not build a knowledge category here.

The implementation context must contain an Implemented contract corresponding to the design's Interface contract. For each actual exposed class, function, endpoint, tool, event, type or other interface, document clearly:

- Input: concrete parameters/data, types/shape, defaults and preconditions needed for correct use.
- Output: concrete returned information/types and errors/failure results.
- Effect: persistent storage, file, runtime-state and other observable changes, including relevant lifecycle/failure effects.
- Usage examples: concrete examples showing how to use that implemented interface.

Update this documentation when implementation interfaces change. Describe actual code; label unfinished interfaces explicitly. Keep examples consistent with the current implementation. Correct obsolete facts and resolved blockers rather than appending a duplicate activity log. If design, code and context disagree, identify the inconsistency and fix implementation/context or propose a user-visible design change; never silently weaken the design.

A useful initial outline is: a Design reference; Implemented contract with Input, Output, Effect and Usage examples; Implementation notes; Verification and continuation. Do not invent implemented interfaces when implementation has not yet been examined or documented.

Use bash with metadata.git.scope=implementation for implementation-code Git commands. Each assigned design also has a separate impl-context-<hash> scope, with its exact ID and context path listed below. Use that scope for context Git status/diff/add/rm/log/show/restore/commit and read-only searches such as grep. File tools can edit working context; dependency context remains read-only. General Bash cannot write protected .rsi files. Stage coherent changes and git commit with meaningful intent; code and context commits are agent-authorized and independent. Committed scope state is available to later members; checkpoints preserve pending edits without changing staging or implying acceptance. Peers are not overwritten automatically.
