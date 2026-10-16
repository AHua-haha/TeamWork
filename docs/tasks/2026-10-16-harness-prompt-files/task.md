# File-maintained base harness prompts

Status: complete
Task start commit: a226c4b502fb40ed2da190a1b230ca3789a5ca83
Review boundary: [Harness](drafts/workspace-agent/harness/design.md)

## Design outcomes

- [delivered] Maintain base, per-scope and shared harness rule text in backend Markdown files.
- [delivered] Load the same file contents for runtime assembly and inspection, with backend-owned dynamic values and explicit asset failures.
- [delivered] Package prompts with compiled backend output; preserve existing enforced scopes, tools, commit rules and member activation deferral.

## Decisions and open questions

Prompts are backend release assets, separate from member prompt files and inaccessible through member management scope. Load once at startup; edits need restart (and rebuild for compiled mode). No hot reload or new configuration interface is added. Code continues enforcing permissions. Existing unrelated .claude/ is preserved.

## Checkpoints and remaining work

Implemented seven Markdown prompt files, a shared startup loader/renderer and build asset copying. Removed embedded base/per-scope/shared rule strings from harness assembly. Canonical harness design/implementation and backend maintenance instructions agree with the completed drafts.

Verification passed: 89 backend unit/HTTP tests; backend TypeScript build and prompt asset copy; compiled loading outside the project cwd; exact packaged prompt bytes, file-sourced content updates, dynamic values, missing/empty assets and missing-variable failures; documentation links/parity/whitespace. Evidence is recorded in [tests.jsonl](tests.jsonl). Scope/Git/Bash enforcement code and frontend behavior are unchanged; no database/provider calls were needed.

This checkpoint is identified by Task-ID: 2026-10-16-harness-prompt-files. Starting commit is recorded above; review remains on codex/lead-harness in the existing project base. No push or merge is performed.
