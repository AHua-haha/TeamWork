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

On open/refresh, omit `runId` to sync and follow the latest run. On reconnect, discard local partials and send the last applied completed-message `position` as `after`. Positions start at 1. Deduplicate completed records by `messageId`/`position`. The same `messageId` identifies its live chunks. A `gap` means drop that partial and wait for a whole record. A Pi `done` event does not mean the backend persisted the response or finished the run; only `message` supplies a committed record and `end` closes the run follow operation. An EOF without `end` requires reconnect/synchronization.

SSE types: `message`, `sync`, `chunk`, `gap`, `state`, `end`; transport errors use `stream_error`. Pi payloads are preserved inside versioned JSON envelopes. `partial` in a Pi event is cumulative; a client using it should replace the current partial rather than appending the same delta again. There is no periodic frontend polling or connection spanning runs.

## Workspace group chat, lead and harness prototype

Create or adopt a workspace and choose the lead model in the frontend. Post workspace requests through the group chat API below. The lead can offer choices, edit pending designs, form the team through submitted configuration files, and assign work through shared responses. Pending designs have independent harness history and require exact user acceptance to commit. The frontend displays the persistent group timeline, final responses and expandable private work. Solo conversations remain supported.

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
```

Every accepted message is shared with all active members. Idle members append it immediately; working members append buffered messages after their private work finishes. Receiving messages alone does not activate a member. Mentioned members run in parallel. Each retains private execution history, with shared messages interleaved individually. Only accepted final responses enter the shared transcript.

A busy, invalid, unavailable or self recipient refuses the entire publication with no partial delivery or queue. Agents receive private feedback to revise or retry. Each user message starts an exchange with an activation budget (default 32); duplicate mentions count once, refused attempts consume nothing, and subsequent response activations share the exchange budget. Stop cancels all active branches. Restart interrupts abandoned work, delivers buffered messages and never replays triggers. Private agent `/follow` APIs remain available for inspection; direct `/agents/:memberId/runs` refuses all members. Existing private history is preserved and is not converted into shared chat history.

A design part is an ordinary user-context JSON file:

```json
{
  "content": "# Backend design\nImplement the agreed backend behavior.",
  "implementation": ["backend/src", "backend/test"]
}
```

Member configuration uses JSON plus Markdown prompts in the lead's private worktree:

```text
.team/members/backend/member.json
.team/members/backend/prompts/member.md
```

Example manifest (`null` memberId/revision creates a member):

```json
{
  "version": 2,
  "memberId": null,
  "revision": null,
  "name": "Backend",
  "role": "developer",
  "responsibility": "Implement the backend design",
  "settings": {},
  "promptFiles": ["prompts/member.md"],
  "harnesses": {
    "project": {
      "designScope": {
        "working": ["user/design/backend.json"],
        "dependencies": ["user/design/api.json"]
      },
      "implementationScope": {
        "paths": ["backend/src", "backend/test"],
        "usePaths": ["shared/api.ts"]
      }
    }
  }
}
```

Use common `write`/`edit` tools, then `submit_member_config({"path":".team/members/backend/member.json"})`. The single submission validates current provider/model/catalog settings and all referenced bytes and atomically stores the exact accepted bundle and its projected member settings. A prompt file change also needs submission. Updates use the returned member ID/current revision and an idle target. Invalid files, stale revisions, busy/foreign targets, unsafe paths and unknown fields preserve the last valid configuration. Agent structured create/update/configure tools are removed; model listing and retirement remain. Existing accepted copies are materialized when missing, without overwriting drafts. `GET /workspaces/:workspaceId/team/members/:memberId/config` reads the stable submitted bundle including digest and attribution; user HTTP settings edits also generate an accepted bundle.

The combined project base owns design management and implementation, including their tools, maintenance prompts and commit rules. Agents configure its designScope and implementationScope together. Its design part requires user acceptance; its implementation part permits agent commits. Both parts keep independent Git histories and pending state. Design implementation mappings do not grant access. Read-only overlap wins; implementation excludes .context, .team and Git metadata. The lead base has workspace-wide safe delegation authority and pending design/member-config file access. Workers cannot submit member configuration or replace fixed base policies.

The separate command harness owns run_command and current exact-vector/executable matching. Richer command boundaries and agent configuration are deferred: new submitted members inherit the lead's current allowances and updates preserve their own. The manifest cannot change them; existing user management configuration remains available. Startup converts active members’ accepted version 1 bundles to version 2 project grouping without changing assigned scopes, command permissions, prompt bytes or Git histories. Existing pending drafts remain untouched; convert them to harnesses.project and update their revision before submitting.

The harness assembles purpose/maintenance rule text into the model system prompt. It automatically checkpoints each finished run, including failure/cancellation and interruption recovery. `commit_scope {part, message}` records a semantic implementation commit without user approval. Design commits require user acceptance of exact reviewed bytes/base. `scope_history` and `restore_scope` inspect/restore one part independently; no agent checkpoint tool is provided.

Private bare Git storage is created next to the original workspace under `.rsi-harness/<workspace-path-hash>/`, with a retained worktree per member. Scoped snapshots use alternate indexes and shared objects; the original project's branch/index and files are not changed. Accepted snapshots are retained in harness Git; automatic integration into the original catalog or existing peer worktrees is deferred. A new work area initializes its assigned parts from their committed snapshots. Stale bases are refused; explicitly restoring the latest committed snapshot refreshes a work area's base.

Backend review/acceptance is available without adding configuration UI. Under `/workspaces/:workspaceId/team/members/:memberId/harness`:

- `GET` returns worktree directory and per-part state, review revision and diff.
- `GET /:part/history` returns checkpoint/semantic-commit history.
- `POST /:part/commit` with `{revision, base, message}` accepts the exact reviewed state as the user; idle member required.
- `POST /:part/restore` with `{revision}` restores one part; idle member required.

For example, review the member, take `revision` and `state.committed` from its `design` part, then submit them as `revision` and `base` to `/design/commit`. A changed working file or committed base causes `stale_revision`; inspect again. Actor/approval fields cannot be supplied through agent tool arguments.

Workers need a nonempty design or implementation assignment and empty catalog tool selections. Startup freezes existing design-derived permissions into explicit implementation paths once, retains existing settings/commands, and stores accepted file bundles. Later design mapping changes do not alter authority. Git must be installed; no Git author setup or credentials are needed for local harness snapshots.

`run_command` uses the member's private worktree with exact executable/argument matching, no implicit shell parsing, 64 KiB retained output and a 60-second timeout. Group termination finishes before cancellation checkpointing. Filesystem confinement of permitted command effects and automatic context-maintenance machinery remain deferred.

Contracts: [lead](../docs/systems/workspace-agent/team/lead/design.md), [harness](../docs/systems/workspace-agent/harness/design.md), [design parts](../docs/systems/workspace-agent/context-base/design-parts/design.md), and [team](../docs/systems/workspace-agent/team/design.md).

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

Defaults: maximum 32 model calls per run; sequential tools; retain at most 256 active-message events / 8 MiB of serialized event data. Counts and byte limits are constructor options. Message completion atomically clears its chunks. Tool/model errors fail the run; completed records survive. Cancelled or failed partial model output is discarded. Restart marks unfinished runs interrupted; it does not replay external tool effects. Tools and hooks must honor cancellation.

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

Entries have stable `entryId`/`position` and increasing `revision`. User entries contain text; member entries identify member/name/run, private `working:{after,through}` history range and an optional exact `finalRef:{agentId,runId,messageId,position}`. Reads resolve accepted final `text`; private work remains separate. The interval is `(after,through]`; `through` is null while running. POST `/messages` acknowledges affected `entries` immediately. Merge those by revision without advancing the stream cursor. Never submit a final reference from the browser: the member runtime supplies its exact committed response identity.

Old prototype history imports once in publication order. New admissions reserve response positions in mention order, and terminal failures preserve those entries without inventing final answers.
