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

## Customize the runtime

The exported `AgentRuntime` always owns the loop. `RuntimePolicy` supplies:

| Hook | Responsibility |
| --- | --- |
| `beforeStep(scope)` | Read/replace canonical stored context, including compaction |
| `buildRequest(scope, history)` | Choose model, exact Pi context/messages, declared tools, options and executable handlers for each call |
| `executeTool(tool, args, scope, call)` | Optional centralized tool execution hook |
| `shouldContinue(scope, response, results)` | Decide whether the loop makes another call |
| `messageMetadata(scope, message)` | Attach JSON metadata to completed model/tool records |

`configuredPolicy()` is the default policy. It uses the config snapshot resolved before each run and the canonical context history for each model call. `fixedPolicy(model, tools, systemPrompt?, options?)` remains available for custom in-process policies. Tool handlers use Pi's `Tool` schema and receive validated arguments, the call identity, and a run-scoped abort signal. `piModelStream(models)` connects to a Pi provider collection. The stream function is injectable for custom model dispatch or tests. The executable ships with no tools; register the tools your application needs and expose them through catalog entries.

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
