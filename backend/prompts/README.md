# Base harness prompts

Fixed team response/routing rules live in `team/group-chat.md`. MemberContext loads this required file at startup and the backend build packages `team/` alongside the harness assets. Agent final responses use an optional leading `<mentions>` JSON-array block; body @ text has no routing meaning. User composer mentions retain their existing behavior.

Maintain harness rule text in the Markdown files under `harness/`:

- `common.md`: shared workspace, ordinary project Git and approval instructions.
- `management.md`: design and member maintenance rules.
- `management-design.md` and `management-members.md`: design/member resource maintenance instructions.
- `implementation.md`, `implementation-scope.md` and `implementation-context.md`: implementation-code/context maintenance and ordinary Git history rules.
- `design-template.md` and `implementation-context-template.md`: initial root context content rendered at workspace bootstrap.
- `execute.md`: persistent Bash shell/job and broad sandbox resource rules, and reusable web-search/fetch usage rules.

`{{workspace}}` in common is replaced with a backend-owned value. Execute permissions are fixed by the base harness, independently of historical command-rule fields. `{{design}}` and `{{context}}` render each implementation-context resource; `{{project}}` renders the initial design title and `{{design}}` also renders the initial implementation-context reference. Other text is delivered as written to runtime/inspection. Unknown template values fail assembly. Required files are loaded once; missing/empty files fail backend startup. There are no hardcoded fallback rules.

Restart development mode after editing prompts. For compiled use, run the backend build and restart: the build copies the files into `dist/prompts/harness/`. Loading is relative to the module, independent of the shell's working directory. Deploy the complete `dist/` directory.

These are backend-maintained base rules, separate from member Markdown prompts. Enforced tools, path boundaries, sandboxing and approval policies remain in backend code; editing a prompt does not change authority.

Design uses purpose/responsibilities/boundaries, Interface contract and constraints/specifications/requirements. Implementation context documents exact Input, Output, Effect and Usage examples for actual interfaces. These content requirements are instructions to the agent; storage accepts ordinary text without a semantic heading validator. Reusable knowledge is outside context and deferred.

Context templates now initialize design/metadata.json, design/design.md and implement/impl/README.md under the context container. Rule Markdown describes complete system designs represented by one file or multiple documents, independently of real child-system decomposition. No Markdown content is embedded in JSON metadata.

Management/implementation prompts describe working and dependency permissions, each with design context, implementation context and project implementation. Only the lead edits designs; implementation context/code for every member follows accepted assignments.

Pi read/ls/grep/find use default operations for workspace reads. write/edit retain input-based assignment checks. Pi content, details and native truncation are preserved. Bash has its own per-member persistent shell, native jobs and whole-workspace write sandbox; these broader permissions are distinct from file-tool input checks.

## Private context preparation

`harness/context-compaction.md` is the release-owned instruction passed by Runtime to Agent. Agent uses one configured token threshold before ordinary model calls and after work ends. Every new preparation message after the control prompt is retained, with Next steps when work remains. Agent durably hosts preparation/cutover; Team preserves original shared history. No extra routing tool or group response is introduced.
