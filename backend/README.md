# Backend

TypeScript backend with a backend-owned agent loop, Pi AI 0.87.1 provider integration, MySQL persistence, and a sync-then-follow SSE protocol. The [frontend](../frontend/README.md) consumes that protocol.

## Run locally

For the complete local stack, install dependencies in `backend/` and `frontend/` with `npm ci`, then run `./scripts/dev.sh start` from the repository root. Use `./scripts/dev.sh status` to inspect it and `./scripts/dev.sh stop` to stop it. The script creates `backend/.env` from the example if needed, stores logs under `.run/`, and preserves MySQL data on stop.

To start the backend manually, run these commands from `backend/`.

Requires Node.js 22.19+ and MySQL 8.4. Docker Compose can supply the local database:

```sh
npm ci
docker compose up -d --wait
cp .env.example .env
# Edit .env: set the database URL and a stable CONFIG_ENCRYPTION_KEY.
npm run dev
```

The service initializes its schema and listens on `127.0.0.1:3000`. `.env` is ignored by Git. `CONFIG_ENCRYPTION_KEY` must be a stable base64-encoded 32-byte key to save and later use provider API keys; `./scripts/dev.sh start` generates one in `backend/.env` if needed. Keep this key when preserving the database. Known Pi providers can also resolve credentials from their deployment environment when a connection has no saved key. Provider connections and tool/prompt choices are editable globally; each agent selects its model and call options. There is no deployment-wide default model. A custom entry point can register Pi providers, executable tools, and policy hooks. Only one runtime can own a database at a time.

For compiled execution:

```sh
npm run build
npm start
```

The server has no built-in authentication or tenant authorization. Its default binding is local; deployments that expose it must supply access control. The current schema initializer creates missing tables; future schema changes will require migrations.

## Submit and follow

```sh
curl -s http://127.0.0.1:3000/agents \
  -H 'Content-Type: application/json' -d '{"agentId":"demo"}'

# Create a reusable provider connection. Its API key is write-only in the API.
curl -s http://127.0.0.1:3000/config/connections \
  -H 'Content-Type: application/json' \
  -d '{"id":"openai-main","value":{"label":"OpenAI","provider":"openai","baseUrl":"https://api.openai.com/v1","api":"openai-responses","apiKey":"YOUR_API_KEY"}}'

# Ask the backend for available models; select a returned choice by its name.
curl -s http://127.0.0.1:3000/config/connections/openai-main/models
curl -s http://127.0.0.1:3000/agents/demo/config
curl -s -X PUT http://127.0.0.1:3000/agents/demo/config \
  -H 'Content-Type: application/json' \
  -d '{"revision":0,"value":{"name":"Demo","connectionId":"openai-main","modelId":"gpt-4.1-mini","toolOptionIds":[],"prompt":"","promptOptionIds":[],"modelOptions":[]}}'

curl -s http://127.0.0.1:3000/agents/demo/runs \
  -H 'Content-Type: application/json' -d '{"input":"Hello"}'

# Use runId returned above. This request syncs history, follows one run, then ends.
curl -N 'http://127.0.0.1:3000/agents/demo/follow?runId=RUN_ID&after=0'

curl -s http://127.0.0.1:3000/agents/demo/state
curl -s -X POST http://127.0.0.1:3000/agents/demo/runs/RUN_ID/cancel
```

The model ID in the agent config comes from the backend's model-list response. Known Pi models appear without network discovery. The connection's protocol and base URL determine how every selected model is called, including Pi-known models; Pi supplies their identity and capability metadata. For an OpenAI-compatible custom endpoint, `POST /config/connections/{id}/models/refresh` refreshes and saves its `/models` list. For an Anthropic-compatible connection, choose `anthropic-messages` and the provider root URL (for example `https://api.anthropic.com`); refresh reads `/v1/models` with Anthropic headers and follows pagination. DeepSeek's Anthropic-compatible connection uses `https://api.deepseek.com/anthropic`. Unknown discovered models use conservative, unverified text-only limits. A failed refresh leaves the prior saved discovery list. An agent's `modelOptions` holds at most one entry per model, `{connectionId, modelId, reasoning?, temperature?, maxTokens?, contextBudget?}`; a run uses only the entry for its selected model. `reasoning` is one of `off`, `low`, `medium`, `high`, `xhigh`; each model choice's `reasoningSentAs` shows the Pi level actually sent when the model clamps it. The context budget is saved for future context management but does not yet trigger automatic compaction. Connection and agent edits are revisioned, and each run keeps the snapshot resolved at its start.

The input body contains only new user content. Sending stored model context is rejected. Concurrent input returns 409; submission is not idempotent, so an uncertain response must not be blindly retried.

On open/refresh, omit `runId` to select the latest run. Reconnect discards local partials and supplies the last completed history `position` as `after`. The API synchronizes SQL history, then replays a retained start for the unfinished message and follows compact progress. A missing/evicted start yields a gap: discard that partial and wait for its whole completed record or the next message start. Completion is persisted before announcement. EOF without `end` reconnects through the same synchronization.

Execution SSE envelopes are version **2**, with `message`, `sync`, `chunk`, `gap`, `state`, `end` (transport failures use `stream_error`). Chunks carry compact Pi-derived start/block/delta/end frames; start uses `message` with empty content and no frame contains cumulative `partial`. Text/thinking/tool identities and signatures are preserved. Whole Pi completed records replace reconstructed partials. Provider `done` is not exposed as durable completion. Group timeline remains version 1.

Progress lives only in a per-member FIFO of 1,024 events across recent messages. Immediate count-based eviction never waits for readers. No chunk writes/reads occur in SQL; the old transient tables are removed at migration. Progress-only notifications read memory; durable notifications read SQL history/state. Restart loses unfinished progress and recovers interrupted runs while retaining completed history.

## Web search and fetch

Set `DEEPSEEK_WEB_API_KEY` in the backend deployment environment or ignored `backend/.env`, then restart the backend. It is a backend-only credential, separate from model connection configuration; members can use any model provider. No UI or member configuration is required. All workspace members receive both capabilities through their fixed execute harness independently of historical command-rule fields. Bash uses the broad execution policy below.

- `web_search({query, count?, original_question?})`: count defaults to 5 (1–50); query and optional original_question are 1–128 Unicode characters and cannot be whitespace-only. Put filters in query, for example `agent harness site:github.com lang:en after:2026-01-01`. DeepSeek receives `ori_question` and `need_content: false`; full page reading uses fetch.
- `web_fetch({url})`: HTTP/HTTPS URL with a host, no embedded credentials, at most 8192 characters. Returns the provider's Markdown page content.

Both return a single text block containing Markdown core information followed by YAML metadata inside `<metadata>...</metadata>`, without an outer JSON string. Search core content lists titles, URLs and snippets capped at 300 Unicode characters each (including an ellipsis when shortened); metadata includes query, source metadata, counts and per-source snippet_truncated. Top-level truncated also reflects shortened snippets. Provider summary/content are never substituted for an empty snippet. Fetch metadata includes requested URL and title. Both include provider/status/retrieval time/truncation. Tool results use the existing stored execution history and follow API. There is no extra model summarization call.

Requests have a 30-second deadline and a 4 MiB response-body limit. Core Markdown is capped at 64 KiB of UTF-8 text with visible truncation. No matches is successful; missing credentials, invalid input and provider failures return recoverable error tool results for the agent to handle without stopping its loop. No automatic retry is performed. Cancellation aborts HTTP. Credentials and raw provider error bodies are excluded from results.

[Web tool contract](../docs/systems/web-tools/design.md) · [DeepSeek API documentation](https://api-docs.deepseek.com/guides/search/)

## Workspace models

Create/adopt requires `models: {models: [{connectionId, modelId, reasoning?, temperature?, maxTokens?, contextBudget?}], defaultModel: {connectionId, modelId}}`. Configure 1–50 distinct connection/model pairs and a default from that list. Models must already be available from configured providers. For example:

```sh
curl -s http://127.0.0.1:3000/workspaces -H 'Content-Type: application/json' -d '{
  "name":"Example", "directory":"/absolute/path/example", "adopt":true,
  "models":{"models":[{"connectionId":"openai-main","modelId":"gpt-4.1-mini"}],
    "defaultModel":{"connectionId":"openai-main","modelId":"gpt-4.1-mini"}}
}'
```

Workspace, models and initialized lead persist atomically; invalid model settings create no directory. `GET /workspaces/:id/models` returns `{revision,value,issues}`; `PUT` takes `{revision,value}` and rejects stale writes. **Team → Workspace models** edits this record. Changing the default preserves existing member selections. New members use the workspace default rather than copying the lead, and `list_models` exposes workspace choices to the lead. A file submission can select these models or retain an existing selection removed from the list. Provider validation still applies.

Startup initializes legacy workspace choices once from existing member selections. Saving a default initializes a legacy lead only when it has no assigned provider/model. Member inspection remains read-only. Group-chat avatars provide user model settings; inspect accepted source/prompts and harness policies through **Team → Active members**. Separate user commit and activation controls are available in **Configuration changes**. Existing file review/history/acceptance APIs retain their behavior.


### User model settings for a member

Hover, focus or click a group-chat member avatar to choose its model, reasoning level, output limit, temperature and context budget. Changes save for its next run, including while it is busy. They preserve member files, prompt/tool configuration and scope, and survive later file activation.

`GET /workspaces/:workspaceId/team/members/:memberId/model-settings` returns `{id, revision, value, issues}`. `value` has `connectionId`, `modelId`, and per-model `modelOptions`. `PUT` to the same path accepts `{revision, value}`; unknown fields, invalid model capabilities, foreign/retired members and stale revisions are refused. User preferences live on the member database record separately from the activated manifest and have precedence in effective settings/readiness/run preparation. Users may choose any model on a configured connection; workspace choices still govern agent-created defaults. Other member mutations remain file-based.

## Workspace group chat, lead and harness prototype

Create or adopt a workspace with its model choices/default in the frontend. Its lead starts with the default model. Post workspace requests through the group chat API below. The lead can offer choices, edit pending designs, maintain pending member configuration files, and assign work through shared responses. Pending designs have independent harness history and require exact user acceptance to commit. The frontend displays the persistent group timeline, final responses and expandable private work. Solo conversations remain supported.

```sh
# Replace WORKSPACE_ID with the registered workspace ID.
curl -s http://127.0.0.1:3000/workspaces/WORKSPACE_ID/team/chat/messages \
  -H 'Content-Type: application/json' -d '{"text":"Help clarify the project design"}'

# No mention in user input triggers Lead. Explicit mentions trigger only their recipients.
curl -s http://127.0.0.1:3000/workspaces/WORKSPACE_ID/team/chat/messages \
  -H 'Content-Type: application/json' -d '{"text":"@Backend @{Frontend Worker} implement your assigned designs"}'

# Persistent group history; use the last received position to fetch the next page.
curl -s 'http://127.0.0.1:3000/workspaces/WORKSPACE_ID/team/chat?after=0&limit=100'
# Follow spans member runs; it exposes shared final messages and run status, never private chunks.
curl -N 'http://127.0.0.1:3000/workspaces/WORKSPACE_ID/team/chat/follow?after=0'

curl -s -X PUT http://127.0.0.1:3000/workspaces/WORKSPACE_ID/team/chat \
  -H 'Content-Type: application/json' -d '{"mentionLimit":32}'
curl -s -X POST http://127.0.0.1:3000/workspaces/WORKSPACE_ID/team/chat/stop
# Explicitly clear this workspace's conversation only after all members finish.
curl -s -X POST http://127.0.0.1:3000/workspaces/WORKSPACE_ID/team/chat/reset
```

Every accepted message is shared with all active members. Idle members append it immediately; working members append buffered messages after their private work finishes. Receiving messages alone does not activate a member. Mentioned members execute sequentially in one shared workspace; agent final headers name at most one distinct recipient. Each retains private execution history, with shared messages interleaved individually. Only accepted final responses enter the shared transcript.

Agent final responses use an optional leading routing header; the report body is never scanned for @ mentions:

```text
<mentions>
["Backend"]
</mentions>

Please implement the accepted design. @joplin/lib and @Nobody here are ordinary text.
```

Omit the block when nobody should run; an empty block or `[]` is also valid. Names are matched ignoring case and duplicates count once. Invalid header syntax or recipients refuse the whole publication with private feedback. Only the body is displayed and delivered as the shared message. Raw private history retains the original response. New final references include backend-owned `bodyOffset` alongside `contentIndices`; old accepted references remain unchanged. User composer `@Name` / `@{Name With Spaces}` input keeps its existing routing/default-lead behavior.

A busy, invalid, unavailable or self recipient refuses the entire publication with no partial delivery or queue. Agents receive private feedback to revise or retry. Each user message starts an exchange with an activation budget (default 32); duplicate mentions count once, refused attempts consume nothing, and subsequent response activations share the exchange budget. Stop cancels all active branches. Restart interrupts abandoned work, delivers buffered messages and never replays triggers. Private agent `/follow` APIs remain available for inspection; direct `/agents/:memberId/runs` refuses all members. Existing private history is preserved and is not converted into shared chat history.

A system node has metadata.json containing only implementation paths, and Markdown document content:

```text
.rsi/context/
  design/backend/
    metadata.json     # {"implementation":["backend/src"]}
    design.md         # OR design/README.md plus Markdown documents
  implement/backend/
    impl.md           # OR impl/README.md plus Markdown documents
```

The metadata path identifies the node. References are relative to the design root: metadata.json for root, backend/metadata.json for backend. Raw file paths include design/ or implement/. Large context can use multiple documents without creating child systems; actual child nodes have their own metadata and paired contexts. Each representation allows 1–100 nonempty Markdown documents/1 MiB total, requires README.md in directory form and forbids simultaneous file/directory forms. Semantic prose sections remain harness instructions.

Member configuration uses JSON plus Markdown prompts in the shared workspace:

```text
.rsi/members/backend/member.json
.rsi/members/backend/prompts/member.md
```

Example editable manifest (identity, format version and revisions are backend-owned):

```json
{
  "name": "Backend",
  "role": "developer",
  "responsibility": "Implement the backend design",
  "settings": {},
  "promptFiles": ["prompts/member.md"],
  "designScope": {
    "working": ["backend/metadata.json"],
    "dependencies": ["api/metadata.json"]
  },
  "execute": {"allowedCommands": []}
}
```

Use common write/edit tools for pending files. Only the lead receives write/edit tool permission and validation capability for member files; read-only tools can inspect the workspace. User acceptance is required for design and member-config semantic commits. Accepting member files does **not** create/update/retire active members. The user activates the reviewed committed change set separately, atomically, while the entire workspace is idle. The former submit_member_config and retire_member agent shortcuts are removed; list_models remains read-only and validate_member_config validates the complete .rsi/members file change set without committing/activating. Existing member updates may change only execution rules, supplementary prompts and responsibility; name, role, model/run settings and design assignments stay fixed. Delete retires a worker while preserving history/files; the lead cannot be deleted. Bundle files seed once; deliberate deletion is preserved across requests/restarts.

Base rule text is maintained in [backend/prompts/harness](prompts/README.md), including common and per-scope instructions. Runtime and inspection load the same Markdown files. Restart development mode after edits; compiled use requires rebuilding and restarting. Build output includes the required assets. Prompt text does not change enforced scope/tool/approval policy.

Three fixed bases assemble common tools and maintenance prompts:

- **management:** lead-only global design editing and member management at .rsi/context/design and .rsi/members; other members read/follow assigned designs, user-approved design/member commits;
- **implementation:** writable paths derived from accepted working designs, dependency mappings/context read-only with overlap precedence; paired working-design implementation context is editable; code/context commits allowed independently for the agent;
- **execute:** a persistent Bash per member with system reads, whole-workspace/owned-temporary writes, outbound networking, local binding and native background jobs.

designScope selects assignment; execute.allowedCommands remains source-format data without controlling execution. No other base policy is configurable in member JSON. No explicit implementationScope assignment or base-policy override is accepted. The inspection member view retains implementationScope as a backend-derived projection. GET /workspaces/:workspaceId/team/members/:memberId returns {member, configuration, harnesses}, including stable source metadata and all three effective definitions without creating additional checkouts. Member POST/PUT/DELETE and separate /config remain absent.

One bash tool replaces run_command and the dedicated scope commit/history/restore tools:

```json
{"command":"git add . && git commit -m \"Implement backend route\"","metadata":{"git":{"scope":"implementation"}}}
```

Use scope design or member-config for protected files; agent git commit is refused with approval_required and leaves staging pending. Supported Git commands are status, diff, add, rm, log, show, restore and commit with the finite options in the harness contract. One invocation selects one scope; metadata cannot supply identity/approval or retarget repositories. Metadata-selected ordinary Git calls, including descendants, use the backend bridge. Unscoped Git is native; broad Bash can modify workspace/Git metadata directly, so the bridge is a workflow control rather than an exclusive security boundary.

All members operate directly in the registered workspace, one executing member at a time including finalization. Pending edits are immediately visible under existing harness permissions. No member worktree or dependency hydration is created. Implementation Git uses the project repository/current branch and a shared index; commits refuse unrelated staged changes and preserve unstaged edits. The repository is initialized on first implementation Git use if absent. Automatic checkpoints stay private and do not create project commits. Design/member acceptance and implementation-context history remain independently controlled. Existing legacy member directories remain preserved and unused, without automatic import. For stable local review, wait for or stop the team. Git-ignored untracked dependencies/build outputs are excluded from implementation checkpoints.

Generic harness review/acceptance remains available alongside the Team configuration UI. Under `/workspaces/:workspaceId/team/members/:memberId/harness`:

- `GET` returns shared workspace directory and per-part state, review revision and diff.
- `GET /:part/history` returns checkpoint/semantic-commit history.
- `POST /:part/commit` with `{revision, base, message}` accepts the exact reviewed protected/context state as the user; idle member required. Implementation semantic commits use project Git through Bash.
- `POST /:part/restore` with `{revision}` restores one part; idle member required.

For example, review the member, take `revision` and `state.committed` from its `design` part, then submit them as `revision` and `base` to `/design/commit`. A changed working file or committed base causes `stale_revision`; inspect again. Actor/approval fields cannot be supplied through agent tool arguments.

Workers need a nonempty valid design assignment and empty catalog tool selections. Startup strips old explicit implementation paths, migrates active sources to backend formatVersion 4, retains exact previous bundles/settings/commands, and preserves existing pending drafts and historical refs. Existing draft files are never automatically rewritten. There is no automatic accepted-file activation.

### Member configuration activation

1. The lead edits JSON/Markdown and calls `validate_member_config({"path":".rsi/members"})`.
2. `GET /workspaces/:workspaceId/team/configuration/current` inspects the latest files and one active-to-current diff. It returns `active`, `current` (revision, parsed valid members and raw files), flat `changes`, `status` (pending paths, current validation and commit history), and separate `commit` / `activation` review tokens. Reading may seed/checkpoint the shared workspace, without accepting files or changing active members.
3. `POST /workspaces/:workspaceId/team/configuration/commit` with `{"revision":"<commit.revision>","base":"<commit.base>","message":"Accept member changes"}` accepts exact reviewed files as the user. The lead must be idle; active settings remain unchanged. Refresh inspection after success.
4. `POST /workspaces/:workspaceId/team/configuration/activate` with `{"revision":"<activation.revision>","digest":"<activation.digest>"}` activates that exact committed configuration. Response is `{revision, changes, memberIds}`. No agent run starts and pending files remain pending.

The whole workspace must be idle for activation, including admission and finalization. Busy activation returns `workspace_busy`; changed review/active/model/design state returns `stale_revision`; invalid configuration returns `invalid_config`. Nothing partially activates. Reusing a successful activation body becomes stale; fetch fresh inspection. A fresh no-change activation updates the history boundary without advancing member revisions. There is no agent activation tool, auto watcher or automatic retry. **Changes** provides these separate user actions; avatar details stay active-only.

Inspection's active revision/time is recorded atomically with activation. Earlier backend versions did not record a workspace-wide activation boundary; those teams compare active database source bytes with current files and label available history with `historyKnown:false` until the next activation. Runtime configuration still loads from exact database snapshots independently of Git references. Commit history is newest first, up to 100 records (`more` marks older history). Raw text preview limits are 1 MiB/file and 4 MiB total; unreadable/over-limit files return an explicit problem. Patches are capped at 262,144 characters/file with `truncated:true` when needed. Renames appear as add/delete.

The low-level `GET /workspaces/:workspaceId/team/configuration?source=pending|committed` semantic review and generic member-config harness commit endpoint remain available. The current inspection endpoint supplies both operation tokens so the frontend needs one displayed diff and separate pending/committed validation states.

Creation selects workspace models/defaults and valid accepted designs. Update is limited to responsibility, referenced supplementary prompts and execute rules. Reassignment/name/role/model changes require an explicit replacement proposal in a fresh bundle. Retired bundle paths cannot be reused. JSON version/identity/revision fields are invalid; backend source envelopes own formatVersion and acceptedRevision. Relevant files must be UTF-8 text; missing referenced prompts invalidate the batch. Startup migrates old accepted sources with their previous exact bytes retained; existing drafts need explicit schema reconciliation, including execute assignment.

Every member receives Pi's native read, ls, grep, find, write and edit tools with default operations, schemas, content/details and native truncation. Harness checks input paths before invocation: read-only tools inspect workspace content freely; write/edit remain restricted by accepted working-design/role permissions. No filesystem operations or extra result-format/truncation layer are injected into these tools.

The custom Bash tool takes command, optional cwd, timeout (seconds), background and metadata.git.scope. One shell per member preserves cwd, variables, functions and jobs across calls/runs. Foreground stdout/stderr combine into readable text plus execution metadata; output retains the last 50 KiB. Foreground timeout defaults to 60 seconds; background has no default timeout, and explicit positive values apply to either. Background launch returns native job_id (no PID/cwd/output path); manage with jobs, wait %N and kill %N. Inherited background stdout/stderr go to /dev/null; command-specified redirection overrides them. No output files are created by the tool. Foreground timeout/cancellation resets the shell and its jobs. Reset, retirement, affected configuration activation/update and shutdown also stop shells/jobs. A stopped shell is reported on next use, without replaying commands.

Bash uses @anthropic-ai/sandbox-runtime 0.0.79: macOS sandbox-exec or Linux bubblewrap/dependencies, with no unrestricted fallback. Read system resources subject to OS permissions; write the entire workspace (including .rsi and .git) and its owned temporary area; network/local binding allowed, no executable allowlist. Bash does not enforce assignment write scopes. Writable HOME/cache/tmp live in that workspace's temporary area. A controlled environment does not inherit arbitrary backend variables; filesystem confidentiality is not promised by system read access. Sandbox proxy compatibility still matters. Background jobs can continue changing files after a checkpoint; a checkpoint is an observation, not filesystem quiescence. No CPU/memory quota is introduced. Linux remains unverified by this macOS test environment.

Contracts: [lead](../docs/systems/workspace-agent/team/lead/design.md), [harness](../docs/systems/workspace-agent/harness/design.md), [design parts](../docs/systems/workspace-agent/context-base/design-parts/design.md), and [team](../docs/systems/workspace-agent/team/design.md).

## Predefined Modelflare provider

The backend registers `modelflare` at startup alongside Pi's built-in providers. Select it in the existing provider connection form and supply your API key. No model-definition UI or discovery refresh is required for its 32 predefined agent chat models, including Claude Haiku 5.5, Sonnet 5.5 and GPT-6.1 Sol.

Use `https://modelflare.dev` for Anthropic Messages, or `https://modelflare.dev/v1` for OpenAI Chat Completions / Responses. Model choices are filtered by the model's documented protocol support; use separate connections for different protocols. Use Responses for GPT-6.1 tool calling. Catalog metadata does not establish your key's routing-group access. The dated [complete inventory and metadata sources](../docs/tasks/2026-10-19-modelflare-provider/models.md) covers all 76 observed IDs, including media and specialized models outside the agent chat runtime. Gateway cost rates are unpriced, not copied from upstream billing.

Existing connections are preserved: a connection whose provider is still `anthropic` uses that catalog until you explicitly change it to `modelflare`.

## Customize the runtime

The exported `AgentRuntime` always owns the loop. `RuntimePolicy` supplies:

| Hook | Responsibility |
| --- | --- |
| `beforeStep(scope)` | Read/replace canonical stored context, including compaction |
| `buildRequest(scope, history)` | Choose model, exact Pi context/messages, declared tools, options and executable handlers for each call |
| `executeTool(tool, args, scope, call)` | Optional centralized tool execution hook |
| `shouldContinue(scope, response, results)` | Decide whether the loop makes another call |
| `afterRun(run)` | Finalize harness/file effects after pending operations settle; also invoked before interrupted-run recovery |
| `messageMetadata(scope, message)` | Attach JSON metadata to completed model/tool records |

`configuredPolicy()` is the default policy. It uses the config snapshot resolved before each run and the canonical context history for each model call. `fixedPolicy(model, tools, systemPrompt?, options?)` remains available for custom in-process policies. Tool handlers use Pi's `Tool` schema and receive validated arguments, the call identity, and a run-scoped abort signal. `piModelStream(models)` connects to a Pi provider collection. The stream function is injectable for custom model dispatch or tests. Solo agents have no built-in catalog tools; register them in a custom entry point. Workspace members receive their tools from the harness, including lead design and team operations.

Example policy customization:

```ts
import { Type } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { AgentRuntime, ConfigService, MySqlStore, configuredPolicy, piModelStream, type RuntimeTool } from './src/index.js';

const models = builtinModels();
const store = new MySqlStore(process.env.DATABASE_URL!);
const tools: RuntimeTool[] = [{
  definition: {
    name: 'echo', description: 'Return the supplied text',
    parameters: Type.Object({ text: Type.String() }),
  },
  execute: async args => ({
    content: [{ type: 'text', text: String(args.text) }], isError: false,
  }),
}];
const config = new ConfigService(store, models, tools);
const runtime = new AgentRuntime(store, config, configuredPolicy(), piModelStream(models));
await store.migrate();
await config.initialize();
await runtime.open();
try {
  const { agentId } = await store.createAgent();
  await config.createConnection('openai-main', {
    label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1',
    api: 'openai-responses', apiKey: process.env.OPENAI_API_KEY,
  });
  const agent = await config.getAgent(agentId);
  await config.updateAgent(agentId, agent.revision, {
    ...agent.value, connectionId: 'openai-main', modelId: 'gpt-4.1-mini',
  });
  const run = await runtime.start(agentId, 'Use echo to say hello');
  for await (const event of runtime.follow(agentId, { runId: run.runId })) {
    console.log(event.type);
  }
} finally {
  await runtime.close();
  await store.close();
}
```

Context replacement uses `{revision, entries}` from `scope.readContext()` and `scope.replaceContext(revision, entries)`. It changes actual stored context and never edits display history. An update after a provider request was constructed affects subsequent calls. Metadata and compaction policy are application-defined.

Defaults: maximum 32 model calls per run; sequential tools; retain at most 1,024 compact progress events per member in memory (`progressCapacity` is the constructor option). FIFO eviction is independent of readers and completed SQL history. Recoverable tool errors remain recorded results and allow normal continuation; fatal model/protocol/persistence errors fail the run; completed records survive. Cancelled or failed partial model output is discarded. Restart marks unfinished runs interrupted; it does not replay external tool effects. Tools and hooks must honor cancellation.

## Verify

Set `VERIFY_TASK_ID` to the task whose test log should receive the result:

```sh
export VERIFY_TASK_ID=2026-09-30-config-system
node scripts/verify.mjs npm run check
node scripts/verify.mjs npm test
# Creates and removes its own disposable MySQL container; Docker must be running.
node scripts/verify.mjs npm run test:mysql
node scripts/verify.mjs npm run build
```

Alternatively, run integration tests against a dedicated database:

```sh
TEST_DATABASE_URL=mysql://USER:PASSWORD@127.0.0.1:3306/TEST_DATABASE \
  node scripts/verify.mjs npm run test:integration
```

Integration tests create agents, write data, and intentionally corrupt one test record. Use a disposable database. Tests cover real MySQL transactions and Pi's deterministic test provider; no paid provider credentials are required. Live provider network calls are not part of the automated suite.

## Contracts and implementation

- [Database contract](../docs/systems/database/design.md) and [implementation](../docs/systems/database/impl.md)
- [Agent runtime and HTTP protocol](../docs/systems/agent-runtime/design.md) and [implementation](../docs/systems/agent-runtime/impl.md)
- [Task decisions and verification evidence](../docs/tasks/2026-09-29-agent-platform/task.md)
- [Frontend proposal](../docs/tasks/2026-09-29-agent-platform/drafts/frontend/design.md)

### Group response timeline for the frontend

The workspace UI consumes `GET /workspaces/:id/team/chat/timeline?after=0&limit=100` and `/timeline-follow?after=0`. The first returns `{workspaceId,cursor,changes:[{cursor,entry}],more,mentionLimit}`; the SSE stream emits version-1 `entry` (`change`), `sync` (`cursor`) and `settings` (`mentionLimit`) events, plus transport `stream_error`. Resume from the last contiguous **change cursor**, not a response’s display position or the latest watermark. A member can finish an older reserved section after later messages exist.

Entries have stable `entryId`/`position` and increasing `revision`. User entries contain text; member entries identify member/name/run, private `working:{after,through}` history range and an optional exact `finalRef:{agentId,runId,messageId,position,contentIndices}`. Reads resolve accepted final `text`; private work remains separate. The interval is `(after,through]`; `through` is null while running. POST `/messages` acknowledges affected `entries` immediately. Merge those by revision without advancing the stream cursor. Never submit a final reference from the browser: the member runtime supplies its exact committed response identity.

Old prototype history imports once in publication order. New admissions reserve response positions in mention order, and terminal failures preserve those entries without inventing final answers.

## Unified activity streaming and final acceptance

Workspace members finish with ordinary assistant text. Tool calls continue execution. At natural model completion (`stop`), native `final_answer` text blocks are selected when present; otherwise unphased text blocks are selected, excluding native `commentary`. Commentary-only output continues, and token truncation fails without publication. The team checkpoints, parses the optional leading mention header and offers its body for atomic group acceptance. Busy/invalid mentions refuse the whole publication and return private feedback so the same run can continue.

Private `/agents/:id/follow` synchronizes SQL completed history and version-2 compact in-memory progress, preserving native signatures without cumulative partials. The frontend streams visible text and tools in one activity flow, hiding thinking. Successful group publication pins the latest committed assistant record and exact ordered text-block `contentIndices`; only then does the frontend fold earlier work and keep the complete final visible. Historical plain-message and retired response-tool references remain readable as immutable accepted history. New runs use no completion tool or response-action annotation. Restart the backend and reload the frontend together to use this contract.


### Fresh workspace initialization and local reset

Create/adopt prepares .rsi/context/design/metadata.json, .rsi/context/design/design.md and .rsi/context/implement/impl.md, exact lead JSON/Markdown under .rsi/members/<lead-id>/, and private .rsi/harness checkpoint/approval history. The lead works on root metadata.json, uses the workspace model default and starts without dependencies or project-code mappings, with the fixed broad execute base. All three initial context files share sequence 1. Source/history is clean and active; later design/member changes still require normal user commit/activation. Existing .rsi entries are refused and project implementation/Git is preserved. Old layout is not silently migrated; safe unresolved active references remain inspectable but cannot run.

For a deliberate local clean slate, stop the backend and run `npm --prefix backend run reset:workspace-data -- --apply`. The script uses backend/.env and refuses a database owned by a running backend. It removes all workspace/agent/chat/runtime/context records, agent configs and registered-workspace managed directories (new .rsi, legacy .context/.team and exact legacy harness stores). It retains provider connections/encrypted credentials, app settings, catalogs/model caches and project implementation/Git checkouts. It does not unregister provider connections or drop the database. Paths are quarantined during the transaction and restored if deletion fails; committed cleanup removes the quarantines. Start the backend afterward and create/adopt workspaces afresh. Keep `/.rsi/` out of your project's own version control; initialization does not edit its Git settings or ignore files.

## Design and implementation-context maintenance

Parallel design/implement roots follow the same project-system hierarchy independently of member identity. Design nodes have metadata-only JSON and design.md/design/; mirrored implementation nodes have impl.md/impl/. Metadata references remain stable when documents change form. Root starts with three files; no user/agent category directories are created. The raw context overview is {workspaceId,seq,files,bytes,problems}, and raw file paths are relative to the context container and include their purpose root.

Complete design context describes purpose/responsibilities/boundaries, Interface contract and constraints/specifications/requirements. Implementation context documents exact Input, Output, Effect and Usage examples for actual interfaces. Directory documents stay within one system; do not impose a fixed interfaces/requirements file split. Base Markdown rules instruct reading applicable context, updating facts/examples and continuation information, and surfacing mismatches. Reusable knowledge and automatic maintenance remain deferred.

Permissions have working and dependencies, each with designContext, implementationContext and implementation. Only the lead edits all design context. Both roles edit exact working-node implementation context and accepted mapped code; dependency implementation/context is read-only. The lead role grants no extra implementation rights. Design/metadata acceptance is user-only. Each working node has an agent-committable impl-context-<hash> scope covering both impl.md and impl/, with ID derived from its lower-case metadata path. Use existing Bash metadata.git.scope and ordinary Git commands; histories/staging stay independent of code/design/member state. Only the lead has design Git scope. New read-only member views inherit accepted design files, including user-committed additions, updates and deleted-document tombstones. Semantic commits validate structural form on immutable selected/staged bytes; checkpoints preserve unfinished edits. Write/edit inputs remain scoped, while Bash can write all workspace files including .rsi.

Raw user context mutation can edit design/metadata, but refuses implementation context and mutations under implement/. Semantic design inspection returns metadata plus ordered Markdown documents, aggregate content and a revision covering all design bytes. Members see the same implementation context directly. Accepted design snapshots still govern permissions; pending filesystem edits do not grant authority. Prompt changes require restart (and rebuild for compiled deployments). Existing old-layout data needs explicit repair/reset before new node assignments can run.

### Reset a workspace conversation

The group-chat header's trash control confirms `POST /workspaces/:id/team/chat/reset`. It requires the whole team to be idle, including finalization, and returns `{workspaceId,resetCursor,resetPosition}`. Busy requests return 409 `workspace_busy`; use Stop team and wait first. This explicitly deletes shared messages/reservations/exchanges and every workspace member's private runtime context, messages, runs and chunks, including retired members. It preserves member/model configuration, workspace settings, project and context documents, harness history and other workspaces/solo agents. It does not roll back file effects.

Timeline reads add `resetCursor`; shared-history reads add `resetPosition` (initially 0). Follow streams emit a version-1 `reset` before new data when the supplied cursor precedes the durable boundary, then synchronize again. Timeline reset payloads carry `cursor`; shared-message reset payloads carry `position`. Discard records at/before the boundary and ignore delayed old acknowledgements. Shared counters remain monotonic; fresh private member history starts at zero. Backend startup adds the boundary columns to existing databases.

### Unified pending change review

The workspace panel has a Changes tab for pending design/member files, separate from Team's active information. It shows one flat file list and unified text diff. Approve design and Approve members commit only their own reviewed scope; Activate members remains a separate idle-team action. Approve design before activating members that reference newly proposed designs. Approval refreshes accepted design discovery and member validation; files already reside in the shared workspace; approval changes accepted history and authority.

`GET /workspaces/:id/team/members/:memberId/harness/:part/review` returns `{memberId,partId,revision,base,changes:[{path,action,patch,truncated}]}` comparing the committed scope to a stable current checkpoint. It changes no working files or staged content. Existing scoped user commit APIs accept these exact revision/base tokens; changed files/base refuse stale approval. Member current inspection and separate activation revision/digest remain unchanged. Approved files leave the pending list; pending edits are excluded from activation.

### Sequential execution

User routing and busy-recipient refusal are unchanged. User multi-mentions admit recipients in order, but only one executes at a time. Agent final responses may name at most one distinct member in the leading routing header; more than one is refused with private feedback. Waiting admitted runs keep the existing running state with step zero until execution. Stop/shutdown cancel waiting runs without tools/checkpoints. Different workspaces may run independently.
