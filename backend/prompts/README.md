# Agent prompt ownership

System prompts hold stable rules and instructions. Changing information and runtime-generated private instructions are conceptually separate dynamic inputs. React Harnesses supply fixed systemPrompt contributions and can react through Agent turn data to append private instructions after paired tool results. User-input reactions run at safe idle/pre-run boundaries. File dependency refresh uses a durable private user-role `<system_instruction>` message after 64 new completed context messages; member identity/responsibility injection remains deferred.

| Owner | Prompt | Delivery |
| --- | --- | --- |
| Team | team/instructions.md | Fixed cooperation and member-management system rules |
| Team | team/group-chat.md | Fixed publication and mention-routing system rules |
| Team member configuration | .rsi/members/<name>/agent.md | Activated supplementary system instructions |
| File React Harness | src/core/react-harness/file/instructions.md | Fixed read/write/edit and aggregated-view system rules |
| File React Harness | src/core/react-harness/file/context-maintenance.md | Fixed DESIGN, optional README usage contract and internal-context maintenance rules |
| Default React Harness | src/core/react-harness/default/prompts/instructions.md | Fixed Bash, native search, web and ordinary Git tool-use rules |
| Default React Harness | colocated bash-timeout.md and bash-background-timeout.md | Tool-result metadata hints on the corresponding timeout |
| File React Harness | generated dependency context | Private user-role design tree and discovered usage READMEs at user-input refresh |
| Agent | agent/context-compaction.md | Private user-role control message at a compaction boundary |
| Team | team/group-summary.md | Separate maintenance agent system prompt for shared summarization |
| Workspace | workspace/project-design-template.md | Initial DESIGN document template, not an automatic run instruction |

Member bundles have one member.json and one agent.md. Manifests do not select prompt files or catalog prompts, and inline settings.prompt is rejected. Explicit user activation validates the current file set and saves the active instruction snapshot; file edits alone do not change active runs or future runs. Run preparation uses the active snapshot, not current draft bytes. General catalog options remain a separate solo-agent configuration feature and are not selectable for members.

Startup converts old member prompt selections to the single-file format. Active instruction text and draft files are preserved separately; selected legacy catalog text is flattened once, so later catalog changes no longer affect that member. Missing or malformed drafts remain for repair rather than being overwritten with active instructions. No project Git changes or implicit activation occur during conversion.

Normal member requests combine fixed Team rules, activated agent.md, File system instructions and Default system instructions. Team does not embed generated member identity, responsibility, roster or file locations in the system prompt. Team owns that changing information for future injection. File React Harness owns working-design and dependency usage README context responsibility; DESIGN documents, dependency README bodies and included source are no longer embedded in system prompts. Workspace continues to own filesystem discovery and document-loading APIs.

Prompt assets are resolved relative to their owning module. Required rule files must exist and be nonempty. After changing backend rule assets, rebuild compiled deployments and restart the backend. The backend build copies team/agent/workspace assets and colocated File/Default instructions to corresponding dist paths. Editing agent.md instead requires member activation, not a backend restart.

Private compaction retains its current lifecycle: the instruction prohibits continuing the original task, permits inspection/verification to preserve evidence, and requests conclusions and next steps. Publication-refusal feedback remains a Team-generated private user-role message. These control inputs and generated dependency replacements do not trigger a new user-input reaction. Member configuration contains working assignments only; dependency designs accumulate from file-tool inspection.
