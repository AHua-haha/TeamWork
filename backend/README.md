# Backend

TypeScript backend with a backend-owned agent loop, Pi AI 0.87.1 provider integration, MySQL persistence, and a sync-then-follow SSE protocol. The [frontend](../frontend/README.md) consumes that protocol.

## Development and deployment

Use the [root lifecycle commands](../README.md) to separate environments. `./scripts/dev.sh start` provisions the new `rsi_agent_dev` database, starts the source backend and Vite on the configured ports (this installation: 3100/5373). Both environments use the private project-root rsi.config.json; development logs remain in .run/. Application stop leaves shared MySQL running.

`./scripts/deploy.sh init` initializes private version-2 project configuration from the example with fresh secrets; it never imports legacy settings implicitly. `./scripts/deploy.sh deploy <git-ref>` builds committed source under /tmp and runs the compiled backend with the configured deployment schema/account (this installation: team_work on its own MySQL service, backend port 3101). Deployment configuration is the deployment section of project-root rsi.config.json; never replace its encryption key when keeping saved provider credentials. The built frontend on the configured port (5374 here) proxies API/SSE/uploads to that backend. Development and deployment connections/settings are independent.

For manual debugging, initialize/provision once with scripts/dev.sh start, then stop the managed applications with scripts/dev.sh stop. The shared MySQL service remains available. From backend/:

```sh
npm run dev
# Or compiled development execution:
npm run build
npm start
```

Both direct commands read project-root rsi.config.json (the development section); use deploy.sh to run deployment settings. Node.js 22.19+ and MySQL 8.4 are required. Startup initializes each application's schema. The databases have independent runtime ownership locks; only one backend may own each database at a time. Provider connections are managed separately through each environment's Config UI. Known Pi providers can also resolve credentials explicitly supplied in the configuration’s backend environment object. A custom entry point can register providers, tools and policy hooks.

The HTTP server has no built-in authentication or tenant authorization and binds to loopback by default. Host deployment does not add public exposure or a boot supervisor.

## Submit and follow

```sh
curl -s http://127.0.0.1:3100/agents \
  -H 'Content-Type: application/json' -d '{"agentId":"demo"}'

# Create a reusable provider connection. Its API key is write-only in the API.
curl -s http://127.0.0.1:3100/config/connections \
  -H 'Content-Type: application/json' \
  -d '{"id":"openai-main","value":{"label":"OpenAI","provider":"openai","baseUrl":"https://api.openai.com/v1","api":"openai-responses","apiKey":"YOUR_API_KEY"}}'

# Ask the backend for available models; select a returned choice by its name.
curl -s http://127.0.0.1:3100/config/connections/openai-main/models
curl -s http://127.0.0.1:3100/agents/demo/config
curl -s -X PUT http://127.0.0.1:3100/agents/demo/config \
  -H 'Content-Type: application/json' \
  -d '{"revision":0,"value":{"name":"Demo","connectionId":"openai-main","modelId":"gpt-4.1-mini","toolOptionIds":[],"prompt":"","promptOptionIds":[],"modelOptions":[]}}'

curl -s http://127.0.0.1:3100/agents/demo/runs \
  -H 'Content-Type: application/json' -d '{"input":"Hello"}'

# Use runId returned above. This request syncs history, follows one run, then ends.
curl -N 'http://127.0.0.1:3100/agents/demo/follow?runId=RUN_ID&after=0'

curl -s http://127.0.0.1:3100/agents/demo/state
curl -s -X POST http://127.0.0.1:3100/agents/demo/runs/RUN_ID/cancel
```

The model ID in the agent config comes from the backend's model-list response. Known Pi models appear without network discovery. The connection's protocol and base URL determine how every selected model is called, including Pi-known models; Pi supplies their identity and capability metadata. For an OpenAI-compatible custom endpoint, `POST /config/connections/{id}/models/refresh` refreshes and saves its `/models` list. For an Anthropic-compatible connection, choose `anthropic-messages` and the provider root URL (for example `https://api.anthropic.com`); refresh reads `/v1/models` with Anthropic headers and follows pagination. DeepSeek's Anthropic-compatible connection uses `https://api.deepseek.com/anthropic`. Unknown discovered models use conservative, unverified text-only limits. A failed refresh leaves the prior saved discovery list. An agent's `modelOptions` holds at most one entry per model, `{connectionId, modelId, reasoning?, temperature?, maxTokens?, contextBudget?}`; a run uses only the entry for its selected model. `reasoning` is one of `off`, `low`, `medium`, `high`, `xhigh`; each model choice's `reasoningSentAs` shows the Pi level actually sent when the model clamps it. The per-model context budget is saved separately; automatic compaction uses the environment-level `contextCompactionThresholdTokens` (default 64,000 tokens) for both before-call and after-run checks. Pi’s public estimate measures normalized context. Preparation retains all new private messages and preserves original group context; it does not create a group reply or extra run. Connection and agent edits are revisioned, and each run keeps the snapshot resolved at its start.

The input body contains only new user content. Sending stored model context is rejected. Concurrent input returns 409; submission is not idempotent, so an uncertain response must not be blindly retried.

On open/refresh, omit `runId` to select the latest run. Reconnect discards local partials and supplies the last completed history `position` as `after`. The API synchronizes SQL history, then replays a retained start for the unfinished message and follows compact progress. A missing/evicted start yields a gap: discard that partial and wait for its whole completed record or the next message start. Completion is persisted before announcement. EOF without `end` reconnects through the same synchronization.

Execution SSE envelopes are version **2**, with `message`, `sync`, `chunk`, `gap`, `state`, `end` (transport failures use `stream_error`). Chunks carry compact Pi-derived start/block/delta/end frames; start uses `message` with empty content and no frame contains cumulative `partial`. Text/thinking/tool identities and signatures are preserved. Whole Pi completed records replace reconstructed partials. Provider `done` is not exposed as durable completion. Group timeline remains version 1.

Progress lives only in a per-member FIFO of 1,024 events across recent messages. Immediate count-based eviction never waits for readers. No chunk writes/reads occur in SQL; the old transient tables are removed at migration. Progress-only notifications read memory; durable notifications read SQL history/state. Restart loses unfinished progress and recovers interrupted runs while retaining completed history.

## Web search and fetch

Set `DEEPSEEK_WEB_API_KEY` in the chosen development/deployment `environment` object in project-root `rsi.config.json`, then restart the backend. It is a backend-only credential, separate from model connection configuration; members can use any model provider. No UI or member configuration is required. All workspace members receive both capabilities through their fixed execute harness independently of historical command-rule fields. Bash uses the broad execution policy below.

- `web_search({query, count?, original_question?})`: count defaults to 5 (1–50); query and optional original_question are 1–128 Unicode characters and cannot be whitespace-only. Put filters in query, for example `agent harness site:github.com lang:en after:2026-01-01`. DeepSeek receives `ori_question` and `need_content: false`; full page reading uses fetch.
- `web_fetch({url})`: HTTP/HTTPS URL with a host, no embedded credentials, at most 8192 characters. Returns the provider's Markdown page content.

Both return a single text block containing Markdown core information followed by YAML metadata inside `<metadata>...</metadata>`, without an outer JSON string. Search core content lists titles, URLs and snippets capped at 300 Unicode characters each (including an ellipsis when shortened); metadata includes query, source metadata, counts and per-source snippet_truncated. Top-level truncated also reflects shortened snippets. Provider summary/content are never substituted for an empty snippet. Fetch metadata includes requested URL and title. Both include provider/status/retrieval time/truncation. Tool results use the existing stored execution history and follow API. There is no extra model summarization call.

Requests have a 30-second deadline and a 4 MiB response-body limit. Core Markdown is capped at 64 KiB of UTF-8 text with visible truncation. No matches is successful; missing credentials, invalid input and provider failures return recoverable error tool results for the agent to handle without stopping its loop. No automatic retry is performed. Cancellation aborts HTTP. Credentials and raw provider error bodies are excluded from results.

[Web tool contract](../.rsi/context/implement/backend/core/harness/impl/reference/web-tools/design.md) · [DeepSeek API documentation](https://api-docs.deepseek.com/guides/search/)

## Workspace models

Create/adopt requires `models: {models: [{connectionId, modelId, reasoning?, temperature?, maxTokens?, contextBudget?}], defaultModel: {connectionId, modelId}}`. Configure 1–50 distinct connection/model pairs and a default from that list. Models must already be available from configured providers. For example:

```sh
curl -s http://127.0.0.1:3100/workspaces -H 'Content-Type: application/json' -d '{
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

## Workspace group chat and agent-managed Git

User input uses `POST /workspaces/:id/team/chat/messages` with `{text}` or the documented picture multipart input. No mention triggers Lead; user @ mentions route to active members. Agent finals use an optional leading `<mentions>["Member"]</mentions>` block and may name at most one member. Other @ text is ordinary content. Members share project files and execute sequentially; only final reports enter shared chat. Completed history is SQL-backed, progress is a bounded in-memory delta stream.

`GET /workspaces/:id/team` lists active members. `GET /workspaces/:id/team/members/:memberId` returns active configuration and management/implementation/execute harness resources. These endpoints do not write member files. Agents edit `.rsi/members/<name>/member.json` (the directory exactly matches the unified member name) and referenced Markdown prompts through common tools; `validate_member_config` checks the whole directory. Existing-member updates allow responsibility, supplementary prompts and historical execution settings; identity/models/design assignments remain fixed. User model preferences use the separate model-settings API.

### Git commits and user approval

Agents initialize/manage the ordinary project Git repository. There are no scoped Git references/indexes, private history, automatic run checkpoints or scope commit/restore/history endpoints. Bash metadata currently accepts only `{}`; the old git.scope selector is retired.

Use `git add` for intended paths, then `git commit [-a] -m "meaningful message"`. Implementation-context and mapped project implementation changes commit directly. A candidate mixing design/member files with implementation refuses with split instructions. Design/member-only candidates wait for user approval. Unknown paths refuse; renames count both old/new paths. Ordinary dirty files outside the candidate do not affect the decision. Supported commit flags include repeated/attached messages, `-a/--all`, `--allow-empty`, `--signoff/-s`, `--quiet/-q`, `--no-verify`, and literal `git -C` paths. Other modes (path-only/amend/interactive/signing/repository overrides) return staging guidance. Commit hooks are disabled for mediated commits. Git requires a directory repository at the registered workspace root.

The compact approval input appears above the chat composer. Accept executes the reviewed candidate. Deny skips it; Send feedback skips it and returns the user's text to the agent. Review opens commit details/diffs in the right panel; no diff is embedded in the input. Contents/HEAD changing after review invalidate acceptance. Waiting pauses the foreground timeout. Run cancellation, reset/shutdown and restart do not replay a commit. This checks explicit commands only; indirect scripts/manual Git are outside this workflow guard.

| Endpoint | Result |
| --- | --- |
| GET `/workspaces/:id/team/commit-approvals` | Pending summaries, no diffs |
| GET `/workspaces/:id/team/commit-approvals/:approvalId` | Exact proposed command/message/diff |
| POST same request URL with `{action:"accept"|"deny"|"feedback",message?:string}` | Resolve pending input; original tool returns execution/refusal |
| GET `/workspaces/:id/team/changes` | Read-only committed-to-current design/member file groups |
| GET `/workspaces/:id/team/configuration/current` | Current configuration/status and active-to-current diff |
| GET `/workspaces/:id/team/configuration?source=pending|committed` | Validation/change plan |
| POST `/workspaces/:id/team/configuration/activate` with `{revision,digest}` | Atomic valid committed-member activation while whole team idle |

Commit and activation remain separate. Newer pending files are excluded from activation. Old `/team/configuration/commit` and `/team/members/:id/harness/...` routes are removed.

### Bash execution

Bash accepts command, optional cwd, timeout seconds, background and empty metadata. One shell per member preserves cwd/variables/functions/jobs across calls/runs. Output combines stdout/stderr with plain-text execution metadata, bounded to the last 50 KiB. Foreground timeout defaults to 60 seconds, background unlimited unless specified. Background returns native job_id and defaults inherited output to /dev/null; explicit redirects work normally. Manage jobs with jobs/wait/kill. No output file is created automatically. Foreground timeout/cancellation resets the shell and jobs; member reset/retirement/activated changes/shutdown also stop them.

The sandbox permits system reads, workspace/owned-temp writes, networking/local binding and no executable allowlist. It does not enforce working-design write boundaries. Pi write/edit retain assignment checks; read-only native tools inspect the workspace. Temporary homes/caches stay outside `.rsi`. No CPU/memory quota is added. Linux runtime enforcement remains unverified on the macOS host.

## Predefined Modelflare provider

The backend registers `modelflare` at startup alongside Pi's built-in providers. Select it in the existing provider connection form and supply your API key. No model-definition UI or discovery refresh is required for its 32 predefined agent chat models, including Claude Haiku 5.5, Sonnet 5.5 and GPT-6.1 Sol.

Use `https://modelflare.dev` for Anthropic Messages, or `https://modelflare.dev/v1` for OpenAI Chat Completions / Responses. Model choices are filtered by the model's documented protocol support; use separate connections for different protocols. Use Responses for GPT-6.1 tool calling. Catalog metadata does not establish your key's routing-group access. The dated [complete inventory and metadata sources](../.rsi/context/implement/backend/core/agent/impl/reference/modelflare-inventory.md) covers all 76 observed IDs, including media and specialized models outside the agent chat runtime. Gateway cost rates are unpriced, not copied from upstream billing.

Existing connections are preserved: a connection whose provider is still `anthropic` uses that catalog until you explicitly change it to `modelflare`.

## Customize the runtime

`AgentExecution` owns the in-memory loop; the exported `AgentRuntime` hosts it and supplies persistence/recovery. `RuntimePolicy` supplies:

| Hook | Responsibility |
| --- | --- |
| `beforeStep(scope)` | Read/replace working context, including compaction; Agent acknowledges durable changes |
| `buildRequest(scope, history)` | Choose model, exact Pi context/messages, declared tools, options and executable handlers for each call |
| `executeTool(tool, args, scope, call)` | Optional centralized tool execution hook |
| `shouldContinue(scope, response, results)` | Decide whether the loop makes another call |
| `afterRun(run)` | Finalize harness/file effects after pending operations settle; also invoked before interrupted-run recovery |
| `messageMetadata(scope, message)` | Attach JSON metadata to completed model/tool records |

`configuredPolicy()` is the default policy. It uses the config snapshot resolved before each run and the Agent working context for each model call. `fixedPolicy(model, tools, systemPrompt?, options?)` remains available for custom in-process policies. Tool handlers use Pi's `Tool` schema and receive validated arguments, the call identity, and a run-scoped abort signal. `piModelStream(models)` connects to a Pi provider collection. The stream function is injectable for custom model dispatch or tests. Solo agents have no built-in catalog tools; register them in a custom entry point. Workspace members receive their tools from the harness, including lead design and team operations.

`AgentExecution` is also usable without persistence: supply run/context/settings, policy and model stream, then call `run(signal)` and inspect `snapshot()`. Its optional `AgentObserver` lets a caller acknowledge message start, completed messages, context changes and completion. AgentRuntime uses that interface with AgentData for Agent-owned persistence; the reusable execution mechanism remains usable without a database. See the [Agent implemented contract](../.rsi/context/implement/backend/core/agent/impl/README.md).

Example durable-host policy customization:

```ts
import { Type } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { AgentRuntime, ConfigService, CoreData, MySqlStorage, configuredPolicy, piModelStream, type RuntimeTool } from './src/api/index.js';

const models = builtinModels();
const store = new CoreData(new MySqlStorage(process.env.DATABASE_URL!));
const tools: RuntimeTool[] = [{
  definition: {
    name: 'echo', description: 'Return the supplied text',
    parameters: Type.Object({ text: Type.String() }),
  },
  execute: async args => ({
    content: [{ type: 'text', text: String(args.text) }], isError: false,
  }),
}];
const config = new ConfigService(store.config, models, tools);
const runtime = new AgentRuntime(store.agents, config, configuredPolicy(), piModelStream(models));
await store.migrate();
await config.initialize();
await runtime.open();
try {
  const { agentId } = await store.agents.createAgent();
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

Context replacement uses `{revision, entries}` from `scope.readContext()` and `scope.replaceContext(revision, entries)`. Agent maintains working context in memory. In AgentRuntime, AgentData acknowledges and persists the replacement; immutable display history is unchanged. An update after a provider request was constructed affects subsequent calls. Metadata and compaction policy are application-defined.

Defaults: maximum 64 model calls per run; sequential tools; retain at most 1,024 compact progress events per member in memory (`progressCapacity` is the constructor option). FIFO eviction is independent of readers and completed SQL history. Recoverable tool errors remain recorded results and allow normal continuation; fatal model/protocol/persistence errors fail the run; completed records survive. Cancelled or failed partial model output is discarded. Restart marks unfinished runs interrupted; it does not replay external tool effects. Tools and hooks must honor cancellation.

## Verify

Set `VERIFY_TASK_ID` to the task whose test log should receive the result:

```sh
export VERIFY_TASK_ID=2026-10-23-core-systems
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

- [Backend design](../.rsi/context/design/backend/design.md) and [implementation context](../.rsi/context/implement/backend/impl/README.md).
- [Core](../.rsi/context/design/backend/core/design.md) owns business behavior, data models, SQL and migrations. Its child systems are Agent, Harness, Workspace and Team; persistence is optional per system and currently assigned to Team.
- [API](../.rsi/context/design/backend/api/design.md) owns HTTP/SSE/multipart transport.
- [Storage](../.rsi/context/design/backend/storage/design.md) supplies MySQL resources and generic transactions, with no business schema.
- [Runtime](../.rsi/context/design/backend/runtime/design.md) hosts and wires the backend; the agent loop is inside Core.
- [Task and verification](../.rsi/work/tasks/2026-10-23-core-systems/task.md).

### Group response timeline for the frontend

The workspace UI initially reads `GET /workspaces/:id/chat/history?limit=50`, returning `{workspaceId,cursor,resetCursor,entries,nextBefore,hasOlder}` from one consistent read. Explicit older reads use `/history?before=<nextBefore>&limit=50&resetCursor=<resetCursor>`; original SQL history remains intact. Follow `/timeline-follow?after=<cursor>` after that snapshot. Refresh/reconnect retain loaded entries and resume from the last successfully applied change cursor; only reset or a backend-declared unavailable cursor permits a new latest-50 snapshot. Terminal working sections start folded and load private history separately on expansion.

The incremental change resource remains `GET /workspaces/:id/team/chat/timeline?after=<cursor>&limit=100`. The first returns `{workspaceId,cursor,changes:[{cursor,entry}],more,mentionLimit}`; the SSE stream emits version-1 `entry` (`change`), `sync` (`cursor`) and `settings` (`mentionLimit`) events, plus transport `stream_error`. Resume from the last contiguous **change cursor**, not a response’s display position or the latest watermark. A member can finish an older reserved section after later messages exist.

Entries have stable `entryId`/`position` and increasing `revision`. User entries contain text; member entries identify member/name/run, private `working:{after,through}` history range and an optional exact `finalRef:{agentId,runId,messageId,position,contentIndices}`. Reads resolve accepted final `text`; private work remains separate. The interval is `(after,through]`; `through` is null while running. POST `/messages` acknowledges affected `entries` immediately. Merge those by revision without advancing the stream cursor. Never submit a final reference from the browser: the member runtime supplies its exact committed response identity.

Old prototype history imports once in publication order. New admissions reserve response positions in mention order, and terminal failures preserve those entries without inventing final answers.

## Unified activity streaming and final acceptance

Workspace members finish with ordinary assistant text. Tool calls continue execution. At natural model completion (`stop`), native `final_answer` text blocks are selected when present; otherwise unphased text blocks are selected, excluding native `commentary`. Commentary-only output continues, and token truncation fails without publication. The team parses the optional leading mention header and offers its body for atomic group acceptance. Busy/invalid mentions refuse the whole publication and return private feedback so the same run can continue.

Private `/agents/:id/follow` synchronizes SQL completed history and version-2 compact in-memory progress, preserving native signatures without cumulative partials. The frontend streams visible text and tools in one activity flow, hiding thinking. Successful group publication pins the latest committed assistant record and exact ordered text-block `contentIndices`; only then does the frontend fold earlier work and keep the complete final visible. Historical plain-message and retired response-tool references remain readable as immutable accepted history. New runs use no completion tool or response-action annotation. Restart the backend and reload the frontend together to use this contract.


### Fresh workspace initialization and local reset

Create/adopt prepares .rsi/context/design/metadata.json, .rsi/context/design/design.md and .rsi/context/implement/impl/README.md, exact lead JSON/Markdown under .rsi/members/<lead-id>/, and a static SQL bootstrap control baseline. The lead works on root metadata.json, uses the workspace model default and starts without dependencies or project-code mappings, with the fixed broad execute base. All three initial context files share sequence 1. Source/history is clean and active; later design/member changes still require normal user commit/activation. Existing .rsi entries are refused and project implementation/Git is preserved. Old layout is not silently migrated; safe unresolved active references remain inspectable but cannot run.

For a deliberate local clean slate, stop the backend and run `npm --prefix backend run reset:workspace-data -- --apply`. The npm command uses the development section of rsi.config.json and refuses a database owned by a running backend. It removes all workspace/agent/chat/runtime/context records, agent configs and registered-workspace managed directories (new .rsi, legacy .context/.team and exact legacy harness stores). It retains provider connections/encrypted credentials, app settings, catalogs/model caches and project implementation/Git checkouts. It does not unregister provider connections or drop the database. Paths are quarantined during the transaction and restored if deletion fails; committed cleanup removes the quarantines. Start the backend afterward and create/adopt workspaces afresh. Track intended design/member/implementation-context files in project Git (use git add -f if ignored); never track legacy .rsi/harness; initialization does not edit its Git settings or ignore files.

## Design and implementation-context maintenance

Parallel design/implement roots follow the same project-system hierarchy independently of member identity. Design nodes have metadata-only JSON and design.md/design/; mirrored implementation nodes have impl.md/impl/. Metadata references remain stable when documents change form. Root starts with three files; no user/agent category directories are created. The raw context overview is {workspaceId,seq,files,bytes,problems}, and raw file paths are relative to the context container and include their purpose root.

Complete design context describes purpose/responsibilities/boundaries, Interface contract and constraints/specifications/requirements. Implementation context documents exact Input, Output, Effect and Usage examples for actual interfaces. Directory documents stay within one system; do not impose a fixed interfaces/requirements file split. Base Markdown rules instruct reading applicable context, updating facts/examples and continuation information, and surfacing mismatches. Reusable knowledge and automatic maintenance remain deferred.

Permissions retain working/dependency design context, implementation context and implementation. Lead edits design/member files; both roles edit exact working implementation/context via native file tools; dependencies remain read-only. Bash is broader. Git history is ordinary project history, with explicit commit approval as described above.

Raw user context mutation can edit design/metadata, but refuses implementation context and mutations under implement/. Semantic design inspection returns metadata plus ordered Markdown documents, aggregate content and a revision covering all design bytes. Members see the same implementation context directly. Accepted design snapshots still govern permissions; pending filesystem edits do not grant authority. Prompt changes require restart (and rebuild for compiled deployments). Existing old-layout data needs explicit repair/reset before new node assignments can run.

### Reset a workspace conversation

The group-chat header's trash control confirms `POST /workspaces/:id/team/chat/reset`. It requires the whole team to be idle, including finalization, and returns `{workspaceId,resetCursor,resetPosition}`. Busy requests return 409 `workspace_busy`; use Stop team and wait first. This explicitly deletes shared messages/reservations/exchanges and every workspace member's private runtime context, messages, runs and chunks, including retired members. It preserves member/model configuration, workspace settings, project and context documents, ordinary Git history and other workspaces/solo agents. It does not roll back file effects.

Timeline reads add `resetCursor`; shared-history reads add `resetPosition` (initially 0). Follow streams emit a version-1 `reset` before new data when the supplied cursor precedes the durable boundary, then synchronize again. Timeline reset payloads carry `cursor`; shared-message reset payloads carry `position`. Discard records at/before the boundary and ignore delayed old acknowledgements. Shared counters remain monotonic; fresh private member history starts at zero. Backend startup adds the boundary columns to existing databases.

### Unified pending change review

Changes contains read-only committed-to-current design/member diffs and separate idle member activation. Commit approval lives above the composer; Review opens the exact candidate in the right panel.

The old member harness scope review/commit/history/restore routes are removed. Use the pending commit approval endpoints for exact review; configuration activation stays separate.

### Sequential execution

User routing and busy-recipient refusal are unchanged. User multi-mentions admit recipients in order, but only one executes at a time. Agent final responses may name at most one distinct member in the leading routing header; more than one is refused with private feedback. Waiting admitted runs keep the existing running state with step zero until execution. Stop/shutdown cancel waiting runs without tools or Git history. Different workspaces may run independently.

### Fast Changes review

GET /workspaces/:workspaceId/team/changes returns ordinary committed-to-current design/member file groups and committed-versus-active member status. It preserves staging and files, creates no checkpoints, and avoids full member validation/history enumeration. Per-file patches are bounded; invalid/binary/link/over-limit control files fail explicitly.

Changes displays files immediately, coalesces overlapping refreshes and retains old content during refresh. When approved members differ from active, GET team/configuration?source=committed loads validation/digest separately; files do not wait for it. Approval and idle-team activation use the existing exact-state control endpoints. GET configuration/current remains the comprehensive inspection API for callers needing that data.

### Member conversation context

Agent context continues chronologically across activations. Team provides only a group-context read reference; Agent tracks incorporated messages in its context entries and selects incoming messages itself. Shared message content includes sender identity and native image blocks. Idle members synchronize without activation; busy members append shared inputs only after current work finishes. Own accepted final responses retain provenance without a second model-visible answer.

Success, failure and cancellation preserve recorded private context. AgentRuntime persists and restores Agent snapshots through AgentData; interrupted calls receive explicit context-only missing-result errors without replay. Implementation README files and their Automatic retrieval entries are ordinary project artifacts, not implicit per-run input or commands. Existing databases adopt recorded member history once without resetting workspaces. Explicit chat reset remains the operation that clears context/history. Agent compaction now checks one token threshold before ordinary model calls and after work, retaining all newly prepared private messages plus original shared history. AgentData journals preparation and atomically acknowledges context replacement, with restart recovery and no extra run/publication. HTTP/SSE envelopes are unchanged.


### Workspace group pictures

The workspace composer accepts PNG/JPEG/WebP pictures through picker, clipboard or drop (four images maximum, 10 MiB each), with optional text. The backend uses Pi public image utilities, stores prepared images in SQL and hydrates native image content blocks when constructing each member's working context. Select an image-capable model. Prepared images are bounded to 2000 pixels per edge and a 4.5 MiB base64 budget; WebP is normalized to PNG before resizing. Source originals are not separately retained.

Submit text-only JSON as before, or binary multipart with one text field and repeated images files:

```sh
curl -X POST http://127.0.0.1:3100/workspaces/WORKSPACE_ID/team/chat/messages \
  -F 'text=Examine this screenshot' \
  -F 'images=@/absolute/path/screenshot.png'
```

An image-only multipart submission sets text to an empty string. Accepted user records include optional attachments [{id,name,mimeType,width,height,size}]. GET /workspaces/:id/team/chat/attachments/:imageId serves the prepared binary; history and SSE contain references rather than base64. Invalid images and unsupported triggered models refuse the entire publication. Stored pictures survive restart; resetting group chat removes them with its history. Later model requests that contain shared or tool-read images fail explicitly if their selected model lacks image input.

Working design assignments include the named node and all accepted descendant design nodes recursively, using the design folder hierarchy. The root metadata.json includes all accepted nodes. Effective design prompts, implementation-context resources, mapped-source permissions and member README retrieval use that expansion without rewriting the member configuration. Dependencies remain explicit and read-only on overlaps. Pending child designs grant no authority; accepting them extends existing assignments on the next resolution.

## Harness permission switch

Set `development.harnessPermissionsEnabled` or `deployment.harnessPermissionsEnabled` in project-root `rsi.config.json`. The version-2 configuration requires an explicit Boolean. false grants all active members the available native file and management tools, permits outside-workspace/link file targets, and starts ordinary host Bash without the OS sandbox or Git commit approval broker. Host HOME and installed toolchains remain available; backend database/provider secrets are not injected into the shell environment. Commands have the backend account's OS authority, not administrator privilege. Input validation, result limits, timeouts, shell/job cleanup and semantic member validation/separate idle user activation remain. Operator config derives a child-only RSI_HARNESS_PERMISSIONS_ENABLED startup value; agents cannot change this setting through their member files. Restart with true to restore existing rules. A deployed release must contain the switch implementation; merely restarting an older release does not add it.

## Business data ownership

Each Core business aggregates its in-memory schema, durable representation and related operations under `data/`. Agent owns context/history/run/compaction persistence and its AgentRuntime host. Team owns member/provider/configuration/shared-chat data; Workspace owns registry/context/model/history data; Harness owns its scope/tool-input/approval data. CoreData exposes owner instances and coordinates transactional lifecycle hooks without business SQL. Existing database rows and HTTP/SSE contracts are preserved; no workspace reset is required.
