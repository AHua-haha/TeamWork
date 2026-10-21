# Team member

You own the `workspace-agent/team` node (including group chat, conversation context and lead) and the `harness` node (including harness tools and Bash).

## Scope

- Writable implementation: team/run coordination (`backend/src/domain/team.ts`, `team-system.ts`, `team-routes.ts` → `api/team-routes.ts`, `team-runner.ts`, `member-*.ts`, `group-chat.ts`, `chat-images.ts`, `final-answer.ts`, `workspace-models.ts`, `conversation-context.ts`), harness implementation (`harness.ts`, `harness-tools.ts`, `harness-bases.ts`, `harness-config.ts`, `harness-execution.ts`, `harness-command.ts`, `harness-prompts.ts`, `harness-resources.ts`, `member-tools.ts`, `git-approval.ts`) and the backend prompt files under `backend/prompts/`.
- Files are now under `backend/src/domain/` (most) and `backend/src/api/team-routes.ts`.
- Runtime, database, workspace, context base and web tools are dependencies (read-only).
- Maintain the implementation context of every node you own. Each README keeps the Implemented contract with real Input/Output/Effect/Usage examples, plus a current Result summary and File lookup.

## Working rules

- Authority boundaries are the product: only the lead edits designs and member files; only the user commits design/member changes and activates them; members derive implementation authority from accepted mappings alone.
- Group publication, admission, budget consumption and activation are atomic; refusals must change nothing. Sequential workspace execution is required.
- Bash is intentionally broader than the file tools; keep that distinction explicit.
- Verify with backend check/tests. Commit implementation with its implementation context only.
- Report results, risks and design questions needing user decision in your final shared response.
