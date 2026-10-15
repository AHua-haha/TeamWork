# Lead agent

## Purpose and boundary

The lead is the default recipient of unmentioned user group messages. It helps the user clarify and maintain the project design, forms the team, configures existing member assignments and assigns work through shared mentions. Design and durable knowledge remain independent of member identity. The harness owns file/edit/commit authority and storage; the runtime owns execution.

## Inputs and preconditions

The user selects a model and posts group messages. The lead can propose concrete choices and wait for answers. Design records remain JSON `{content: "Markdown", implementation: [paths]}` in user context, with up to 50 distinct workspace-relative mappings, `.` allowed and `.git`/`.context` excluded.

The lead receives common file tools through its combined project harness and can edit pending user-design files in its separate worktree. It has no special direct-save tool that bypasses approval. All design commits, including the lead's, require user acceptance of the selected revision. Implementation tools follow its explicit editable paths and read-only use paths and permit implementation commits under harness rules.

The lead edits member JSON manifests and Markdown prompt files and calls submit_member_config with only the manifest path. The fixed project harness owns design/implementation tools, mandatory rules and per-part commit permissions; a separate command harness owns existing execution allowances. Workers can receive a design assignment, an implementation assignment or both. Updates require an idle target and current revision.

## Outputs and observable effects

- The lead discusses design choices, uses common read/write/edit tools for pending changes, and explains the changes to the user. User acceptance is an explicit backend operation against an exact reviewed revision/base; conversation text does not supply approval.
- The harness automatically checkpoints the lead's run and records its work independently of semantic commits. Implementation commits can be made through `commit_scope`; design attempts remain pending with `approval_required`.
- The lead creates, updates and retires members through file submission and retirement tools. It assigns work by publishing final shared responses with recipient mentions and objectives. All members receive accepted final reports; private execution stays private.
- Design/implementation commits remain scoped in harness Git. They do not automatically alter the original catalog, assignment mappings or project Git branch. Publishing/integrating newly accepted designs into those surfaces is deferred.

## Failure behavior

Unsettled choices require further discussion. Stale user review/base, malformed design JSON, missing/out-of-scope files and unapproved design commits fail explicitly. Expected tool refusals are recoverable private results. Team assignment/publication retains its atomic refusal rules. Checkpoint/storage failure can fail the run and prevents successful final publication.

## Guarantees and limits

The lead has broad bootstrap read and pending user-design edit access through its default harness. Implementation writes remain bounded by explicit implementation paths; dependencies are read-only. It cannot commit design through agent tools or a claimed user approval argument. Dedicated read_design/save_design tools are removed. Backend acceptance is available; configuration/approval UI, automatic integration across worktrees and automated context maintenance are deferred. Allowed commands remain outside file-tool confinement.

## Acceptance examples

1. The lead edits `.context/user/design.json` with common tools and explains the pending change. The user reviews its diff and accepts the exact revision through the backend; an automatic checkpoint alone does not accept it.
2. The lead configures Backend with working/dependency designs and assigns work using `@Backend`. Backend edits implementation in its own worktree and commits it without accepting the lead's pending design edits.
3. Another edit follows user review. Acceptance of the old revision is refused and preserves the committed design reference.

## File configuration workflow

Use common file tools to edit .team/members/<bundle>/member.json and referenced prompts/*.md, then submit_member_config({path}). The fixed project base permits design working/dependency references and implementation paths/usePaths together under version 2 harnesses.project as its customization. Base tools, mandatory prompts and design approval cannot change. Runtime uses the last valid submitted bundle; pending edits or failed validation do not affect active configuration. Create uses null memberId/revision; updates name a member and its current revision and refuse a running target. A lead cannot submit self-updates while running. Existing command permissions are inherited for new members and preserved for updates. Retirement and model listing remain separate team operations.
