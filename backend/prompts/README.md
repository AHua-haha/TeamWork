# Base harness prompts

Maintain harness rule text in the Markdown files under `harness/`:

- `common.md`: shared worktree, checkpoint and acceptance instructions.
- `management.md`: design and member maintenance rules.
- `management-design.md` and `management-members.md`: per-scope maintenance instructions.
- `implementation.md`, `implementation-scope.md` and `implementation-context.md`: implementation-code/context maintenance and independent history rules.
- `design-template.md` and `implementation-context-template.md`: initial root context content rendered at workspace bootstrap.
- `execute.md`: Bash execution rules and allowed-command information.

`{{worktree}}` in common and `{{allowedCommands}}` in execute are replaced with backend-owned values. `{{design}}` and `{{context}}` render each implementation-context scope; `{{project}}` renders the initial design title and `{{design}}` also renders the initial implementation-context reference. Other text is delivered as written to runtime/inspection. Unknown template values fail assembly. Required files are loaded once; missing/empty files fail backend startup. There are no hardcoded fallback rules.

Restart development mode after editing prompts. For compiled use, run the backend build and restart: the build copies the files into `dist/prompts/harness/`. Loading is relative to the module, independent of the shell's working directory. Deploy the complete `dist/` directory.

These are backend-maintained base rules, separate from member Markdown prompts. Enforced tools, path boundaries, sandboxing and approval policies remain in backend code; editing a prompt does not change authority.

Design uses purpose/responsibilities/boundaries, Interface contract and constraints/specifications/requirements. Implementation context documents exact Input, Output, Effect and Usage examples for actual interfaces. These content requirements are instructions to the agent; storage accepts ordinary text without a semantic heading validator. Reusable knowledge is outside context and deferred.

Context templates now initialize separate metadata.json, design.md and impl.md. Rule Markdown describes complete system designs represented by one file or multiple documents, independently of real child-system decomposition. No Markdown content is embedded in JSON metadata.
