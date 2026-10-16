# Base harness prompts

Maintain harness rule text in the Markdown files under `harness/`:

- `common.md`: shared worktree, checkpoint and acceptance instructions.
- `management.md`: design and member maintenance rules.
- `management-design.md` and `management-members.md`: per-scope maintenance instructions.
- `implementation.md` and `implementation-scope.md`: implementation and history rules.
- `execute.md`: Bash execution rules and allowed-command information.

`{{worktree}}` in common and `{{allowedCommands}}` in execute are replaced with backend-owned values. Other text is delivered as written to runtime/inspection. Unknown template values fail assembly. Required files are loaded once; missing/empty files fail backend startup. There are no hardcoded fallback rules.

Restart development mode after editing prompts. For compiled use, run the backend build and restart: the build copies the files into `dist/prompts/harness/`. Loading is relative to the module, independent of the shell's working directory. Deploy the complete `dist/` directory.

These are backend-maintained base rules, separate from member Markdown prompts. Enforced tools, path boundaries, sandboxing and approval policies remain in backend code; editing a prompt does not change authority.
