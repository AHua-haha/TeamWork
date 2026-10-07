# Config system implementation

## Contract

[Proposed config design](design.md). Editable records can change at any time; resolution returns a consistent copy that an agent run keeps until completion.

## Responsibilities and decomposition

- A TypeScript config service validates app settings, provider connections, catalog entries, and per-agent settings; exposes CRUD, model choices, and run resolution.
- A small secrets module encrypts provider API keys before persistence and decrypts them only for discovery and run snapshots.
- The database system stores versioned JSON records, atomic edits, and consistent resolution reads in MySQL.
- The runtime resolves one config snapshot before accepting input and passes it to policy hooks for each step.
- The HTTP layer exposes config operations and preserves backend validation and revision conflicts.

## Coordination and data flow

The backend loads deployment config, initializes MySQL and the editable app record, then registers Pi models and executable tools. The config service validates edits against this registry. A connection stores an endpoint, request protocol, and encrypted optional API key; read APIs return a redacted connection. Known Pi models are listed for that provider with the connection's effective protocol. `reasoningScale` (`off, low, medium, high, xhigh`) is the only accepted entry reasoning value. `reasoningChoices` returns the whole scale for reasoning models with `defaultReasoning: 'off'` and `reasoningSentAs`, which maps each scale level through Pi's `clampThinkingLevel` for that model; non-reasoning models return no levels, `null`, and an empty map. Model choices and capabilities return these fields to the frontend and run validation. An explicit refresh POST requests `/models` with Bearer auth for OpenAI-compatible endpoints, or `/v1/models` with Anthropic version and API-key headers for Anthropic-compatible endpoints. Anthropic pagination is followed before the result is persisted. Discovered choices are cached under the connection identity. A change to provider, URL, or protocol deletes that cache atomically with the connection edit. Starting a run reads a consistent set of records and resolves the selected connection, model, tools, prompt, and the `modelOptions` entry matching the selected connection and model. Missing reasoning uses the model default; the level is translated through `reasoningSentAs`, and a translated `off` omits Pi's reasoning option. Validation issues consider only that selected entry, so saved entries for other models never block a run. It builds a run-local Pi provider collection with the selected endpoint, protocol, and key. A Pi-known model keeps its identity and capability metadata; when the connection protocol differs from Pi's default, protocol-specific compatibility settings are removed and the selected adapter is registered for this run. The runtime holds that result until the run ends. A later edit is visible only to a later resolution.

## Decisions and constraints

The initial app record contains `title`, `maxInputBytes`, and `allowAgentCreation`. Provider connections are a separate config scope; their encrypted keys use AES-256-GCM and `CONFIG_ENCRYPTION_KEY` from deployment config. Catalog entries are registered-tool choices or prompt templates; provider connections and saved discovery results provide model choices. Unknown discovered models receive conservative Pi metadata. Agent records contain `name`, connection/model selection, selected tool/prompt IDs, direct instructions, and `modelOptions`: per-model entries `{connectionId, modelId, reasoning?, temperature?, maxTokens?, contextBudget?}` with at most one entry per model. Entry validation checks field types and ranges independent of the model; fit to model metadata is reported as an issue for the selected entry. Reading an agent record drops the legacy `callOptions` field and any entry reasoning outside the scale; writes that include `callOptions` are rejected as an unknown field, and an out-of-scale reasoning value is rejected as invalid. Clamping is computed when choices are built, so a Pi upgrade changes sent levels without rewriting saved entries. `temperature` and `maxTokens` are passed to Pi when present, and reasoning as described above. `contextBudget` is retained on the run snapshot for the runtime policy and does not trigger automatic compaction. There are no long-lived config locks or automatic model fallbacks. Initialization migrates earlier model entries into individual connections and moves agent selections to provider/model fields, including discovered custom models. Legacy model records are hidden from the new catalog API.

## Code map

- [backend/src/config.ts](../../../../../backend/src/config.ts): validation, capabilities, CRUD coordination, run resolution.
- [backend/src/secrets.ts](../../../../../backend/src/secrets.ts): authenticated encryption for connection API keys.
- [backend/src/database.ts](../../../../../backend/src/database.ts): versioned scoped MySQL records and repeatable-read bundle.
- [backend/src/runtime.ts](../../../../../backend/src/runtime.ts): run-start resolution and snapshot-bearing policy scope.
- [backend/src/http.ts](../../../../../backend/src/http.ts): config API, agent summaries, app-controlled creation/input size.
- [backend/src/main.ts](../../../../../backend/src/main.ts): deployment config, Pi catalog, startup initialization.

## Verification

TypeScript check, real-MySQL CRUD/revision/snapshot integration, credential redaction and rotation, legacy migration, runtime mid-run edit behavior, endpoint discovery and Pi calls to mocked custom and cross-protocol known-model endpoints, HTTP API tests, and build. [Integration tests](../../../../../backend/test/integration/backend.test.ts) also check that Pi-known DeepSeek and OpenAI models report the shared scale with Pi's clamped sent levels, that non-reasoning models report none, that `minimal`/`max` writes are rejected and stored out-of-scale levels read as unset, and that per-model settings are kept across model switches, validated only for the selected model, isolated between agents, and stripped of legacy `callOptions`, against disposable MySQL 8.4.
