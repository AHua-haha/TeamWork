---
summary: Manages workspace members, shared chat, serial member execution, accepted publication and shared summaries.
include:
  - backend/src/core/team/
  - backend/prompts/team/
  - backend/src/core/context-page.ts
  - backend/test/team-group-chat.test.ts
  - backend/test/member-activation.test.ts
  - backend/test/team-group-context.test.ts
  - backend/test/team-summary.test.ts
---

# Team usage contract

Team owns member records and active configuration, shared user/member publications, routing and admission, response reservations, presentation history and shared summaries. `TeamSystem` composes these capabilities with Workspace and Agent through their owner interfaces. Agent retains private context/history and consumption state. React Harness supplies tools and filesystem execution. Assignment expresses responsibility, including descendant design parts; it does not restrict tool access.

## Construction and lifecycle

`new TeamSystem(store, workspaces, config, web?)` takes a `TeamStore & ChatStore`, `WorkspaceService`, `ConfigService` and optionally web tools. Its `service`, `runner`, `configuration`, `designs`, `memberWorkspace` and `runConfig` expose the corresponding capabilities. `attach(runtime)` supplies the Agent runtime before work is accepted. `initialize()` ensures leads/configuration and workspace model choices are initialized; it is a startup operation, not a read.

`policy(basePolicy)` wraps Agent policy with fixed Team cooperation/routing instructions plus activated `agent.md`, a read-only group-context reference, the workspace execution gate, final publication, and File/Default React Harness factories. Harness factories use the workspace directory for relative paths and current working assignments for context discovery. They do not grant or restrict authority. Changing identity/roster/design prose is not embedded in the fixed system prompt.

Call `startMaintenance()` after the Agent runtime opens. It checks existing workspaces and schedules eligible summaries; a host can leave this startup promise running. `closeMaintenance()` cancels/drains that work. `runner.close()` refuses new publications, waits for in-flight publication and closes shells. Agent runtime shutdown is a separate host responsibility.

## Members and configuration

`roster(workspaceId)` and `memberMetadata(workspaceId, memberId)` expose active identity, name, role, responsibility, lead flag, revision and running state. They do not resolve tools, provider availability or private context. `team()`/`member()` retain richer internal member views. `requireContextMember()` checks active membership in a workspace before an API delegates retained-context inspection to Agent.

The source bundle is `.rsi/members/<name>/member.json` plus conventional `agent.md`. Directory and manifest names must match exactly; active names are unique ignoring case. A team supports at most 20 members. Manifest fields are `name`, `role`, `responsibility`, `settings` and `designScope: {working: string[]}`. Working roots resolve through Workspace, including supported historical references; dependency assignment fields, Harness configuration, inline member prompts and prompt-catalog selection are rejected.

`configuration.validate(activeMemberId, '.rsi/members')` reads the complete current directory and returns `{valid, changes, issues}`. Changes identify create/update/delete operations; issues include path, code and message. It refreshes Workspace's disposable design index but does not activate files. A missing `agent.md`, malformed JSON/UTF-8, unresolved assignment, duplicate name, invalid model/settings or forbidden update prevents activation.

`activateConfiguration(workspaceId)` is the user-control operation. It requires the entire workspace to be idle, validates the current complete directory, then stores all creates/updates/retirements and a new opaque activation UUID together against expected member/model/activation revisions. Removing a worker bundle retires the member; the lead cannot be deleted and retired bundle paths cannot be reused. Existing-file updates may change only responsibility and `agent.md`; identity, role, model assignment and working assignment remain fixed. New workers require a working assignment and valid workspace model. Later filesystem edits stay inactive until another explicit activation. Updated/retired member shells are reset after durable activation; callers must not interpret a later shell-cleanup failure as proof that activation rolled back.

`modelSettings()` and revision-checked `updateModelSettings()` provide separate user model preferences; file activation preserves these overrides. Lower-level `create`, `update` and retirement methods remain internal service capabilities, separate from current-file activation. `create` writes a missing generated source bundle after creating its record, so filesystem errors can follow a durable change.

Default React Harness exposes `list_models({})` and `validate_member_config({path: '.rsi/members'})` to active members. They report configuration; neither tool activates changes. Git commits are not activation inputs. Startup compatibility migration preserves active/draft instruction text separately, flattens historical prompt selection into `agent.md`, removes superseded scope/policy/source-history fields and replaces old activation hashes with application UUIDs. Migration can change legacy files; ordinary inspection does not.

## Shared publications and execution

`runner.postUser(workspaceId, text, preparedImages?)` validates input, resolves explicit user mentions and returns `ChatAcceptance`: the accepted `message`, admitted `runs` and affected timeline `entries`. Text is limited to 20,000 JavaScript characters; an attachment-only user publication is valid. Images must already be prepared and match the chat-image contract. Each explicitly selected recipient must support the attached image input. With no user mention, input routes to the lead.

User routing recognizes `@Backend` or `@{Backend Worker}`, deduplicated ignoring case; emails, bare scoped packages and similar identifiers are ordinary text. Member routing uses only the first optional leading header:

```text
<mentions>
["Backend"]
</mentions>

Please inspect the accepted contract and report the result.
```

`parseMemberResponse()` returns body, names and body offset. It removes the header/separating newlines while preserving body indentation and trailing bytes. A missing or empty header triggers nobody. Names are matched ignoring case, duplicates count once, and at most one distinct recipient is allowed. A nonempty body is required. Body `@` strings and later headers never route work.

`runner.publishFinal(memberId, runId, candidateText, finalMessageId)` accepts only a naturally completed, committed final response of the sender's current run. Team verifies the latest private origin and selected final text before recording its reference. Unknown, busy, retired, unavailable or self recipients, exhausted exchange budget, invalid header, changed configuration or stopped exchanges refuse the publication as a whole. Refused candidates remain private and trigger nobody; recoverable publication errors become private feedback in the same Agent loop. Length-limited completions are not published. Commentary-only responses can continue the loop.

Publication, exchange budget, sender completion, recipient admission and reserved presentation entries commit atomically through Team and Agent owner operations. Default exchange budget is 32 accepted activations; settings allow 1–1,000. Initial user recipients also consume budget. Publication is serialized per workspace, and actual member execution is serialized separately through sender finalization. Admission can reserve the next member while the previous member finishes. The gate is per workspace, not global across workspaces.

After acceptance, Team notifies all active Agents through `syncGroupContext`; this does not activate unmentioned members. Agent decides incorporation boundaries. Busy Agents finish their current sequence before incorporating new input. Native user images remain images. Shared member content contains only accepted public text as an assistant message with Team provenance and zero generation usage; private thinking, signatures and tool traces do not enter shared context. The sender's original private response is referenced so Agent can reconcile it without duplicating its answer.

Every model-visible original shared message starts with one plain-text `<metadata>` envelope containing authoritative `sender` and optional `mentions` names. IDs/order remain structured metadata. Shared reads return detached native Pi entries. SQL append acknowledges before resident shared-context advancement; rollback exposes no speculative state, and uncertain commit invalidates the resident for restoration without replay.

## History, inspection, stop and reset

`runner.history(workspaceId, options?)` returns `{workspaceId, cursor, resetCursor, entries, nextBefore, hasOlder}`. Default latest page is 50 entries; `limit` accepts 1–100. Entries are in display order and member finals are resolved through their immutable references. Older pages require both a positive `before` display position and the original `resetCursor`; reset mismatch raises `history_reset`. History position and live change cursor are different values.

`timeline(workspaceId, after?, limit?)` reads bounded presentation changes; `snapshot()` reads original shared publications and active-run state. Their page limits are 1–500. `followTimeline()` and `follow()` stream updates, synchronization and reset/state information until cancellation or close. A follower disconnect does not stop member execution. Consumers resume after their last applied live cursor and reconcile entry identity/revision; publication acknowledgements are not a substitute for applying live updates. Private working ranges are expanded through Agent history, not loaded into the public final body.

`inspectGroupContext(workspaceId, {offset?, limit?, revision?})` reads effective summary plus original tail as a detached, bounded page with revision/total/next offset. Later pages require the revision (see the included pagination contract); append, reset or summary replacement invalidates it with `context_changed`. It does not warm runtime context, synchronize members or start maintenance. `inspectGroupSummary()` returns `{summary, retainedMessages: 30}`; no summary is represented by `null`.

`runner.stop(workspaceId)` marks exchanges stopped and requests cancellation of admitted/live runs. It does not erase context or wait for all effects to settle. `runner.reset(workspaceId)` requires every member and finalization to be idle, stops shells, clears Team history/images/summary and Agent conversations/component state atomically, advances reset boundaries and clears runtime projections. Project files, context documents and member configuration survive. A normal stop or failed run never implies reset.

## Shared summary maintenance

Team checks a 32,000-token estimated uncovered-public-message threshold after publication and startup. This estimate is approximately serialized-message length divided by four, separate from Agent's request-token compaction estimator. At most one job runs per workspace. It uses the lead's resolved model and the ordinary maintenance Agent loop with only `submit_group_summary`, without a member activation, group publication or member-context rewrite.

A pinned snapshot retains its newest 30 original messages; only its older prefix is supplied for summarization. Later rounds supply the previous summary plus newly eligible older messages. Submission accepts nonempty summary text of at most 24,000 characters; Team supplies and validates revision, source digest and covered positions. A reset or competing summary causes `context_conflict`; ordinary appended messages remain after the pinned tail. Failed jobs preserve the previous summary and may retry on later publication/startup checks. Reads do not generate summaries.

`readGroupContext(workspaceId, after, through?)` supplies Agent's read reference. Incremental reads preserve chronological originals; full reads use shared summary/tail when the summary lies within the caller's upper boundary. If it summarizes beyond that boundary, Team serves archived originals instead. Stable chat history and private final origins remain available independently of the effective model-facing summary.

## Examples

```ts
// Composition: initialize/open in the host's established startup sequence.
const team = new TeamSystem(teamData, workspaceService, configService);
const policy = team.policy(configuredPolicy());
const runtime = new AgentRuntime(agentData, team.runConfig, policy, stream);
team.attach(runtime);
await team.initialize();
await runtime.open();
void team.startMaintenance();

const accepted = await team.runner.postUser(workspaceId, 'Review the current API contract.');
const history = await team.runner.history(workspaceId);
if (history.hasOlder) {
  await team.runner.history(workspaceId, {
    before: history.nextBefore!, resetCursor: history.resetCursor, limit: 50,
  });
}
// Validation is available during work; activation is a separate idle user action.
const review = await team.configuration.validate(activeMemberId, '.rsi/members');
```

These examples assume the owner repositories/configuration, provider stream and workspace already exist. Supporting files listed in `include` supplement this contract and must be opened explicitly when details are needed.
