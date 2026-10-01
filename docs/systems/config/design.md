# Config system

## Purpose and boundary

Config has four scopes. Deployment-owned **system config** starts the backend and database and supplies the encryption key; it has no CRUD API. Editable **app config** holds product-wide settings. Editable **global agent config** holds provider connections and the tool and prompt options available to agents; it supplies choices, not defaults. Editable **agent config** selects one connection and model, tools and prompts, and owns the agent's instructions and model-call settings. The runtime owns the loop, context, requests, and tool execution. The database owns persistence.

## Inputs and preconditions

- The backend receives its database URL and encryption key at startup. An editor supplies full editable values and the last read revision for an update or delete.
- App config contains title, maximum input bytes (1 KiB–2 MiB), and whether new agents may be created.
- A provider connection contains a label, provider identifier, base URL, request protocol, and an optional write-only API key. The supported protocols are OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages. The selected protocol governs calls for every model on that connection, including a Pi-known model. A Pi provider's known model definitions remain backend-owned and supply model identity and capabilities. A compatible endpoint may supply additional model IDs through discovery. Users do not type model IDs.
- Tool options identify registered backend handlers; prompt options contain reusable text. Neither a provider connection nor a tool option creates an executable handler.
- Agent config contains name, `connectionId`, `modelId`, selected tool and prompt option IDs, direct instructions, and optional `reasoning`, `temperature`, `maxTokens`, and `contextBudget`. A new agent may have no model until configured. `contextBudget` is a positive token threshold no larger than the selected model's context window. It is saved in the run snapshot for the runtime's context policy; this version does not automatically compact history when the threshold is reached.

## Outputs and observable effects

- The backend offers CRUD for editable app, connection, tool, prompt, and agent records. Records have revisions; stale writes fail with conflict. Editing is allowed while an agent runs or references the record.
- A connection's model list combines Pi-known models for its provider with models discovered from its endpoint. The backend returns model IDs, capabilities, and the connection's effective protocol. Known Pi models are available without a network call. Explicit refresh queries `/models` for OpenAI-compatible endpoints or `/v1/models` for Anthropic-compatible endpoints, using each protocol's authentication and required version header. Anthropic pagination is followed so the saved list is complete. Refresh saves the result for later reads and runs and does not erase the prior list on failure. A changed provider, URL, or protocol invalidates old discovered choices for that connection. Connection deletion also removes its saved discovery list.
- For a discovered ID unknown to Pi, the backend exposes a conservative text-only definition: 8,192-token context, 2,048-token maximum output, and no reasoning. It is marked unverified. Agents may select it and make basic calls; the endpoint may still reject the request. Known Pi definitions supply their own metadata. A model absent from both the current Pi catalog and the saved discovery list cannot be selected for a run.
- Agent config saves provider connection and backend-supplied model ID directly. Reasoning must be supported by the selected model; max output cannot exceed its maximum; temperature is 0–2. Incompatible settings remain visible and are reported as issues until edited. Omitted options are omitted from the Pi call.
- Before accepting each run, the backend resolves a consistent, independent snapshot of app, agent, selected connection, discovered model data, and selected tool and prompt definitions. The run uses it until completion; edits affect the next run. A run does not hold a lock on editable config. The snapshot includes source revisions and the decrypted key, which is never returned to the frontend.
- App and UI consumers resolve at their own read points. Editing config does not rewrite message history or an active run's context.

## Failure behavior

- Invalid data, unsupported fields, stale revisions, and missing records fail explicitly without changing the previous record. A discovery failure preserves the previous cached model choices and reports the error.
- An agent with no selected model, a missing connection or model, or incompatible call options cannot start a run; its proposed user input is not accepted as a run. There is no silent fallback model.
- A provider credential or endpoint failure during a run is a run error. A stored key is encrypted at rest, never returned by reads or logged, and decrypted only on the backend. Invalid deployment encryption configuration prevents saving or using saved keys.
- An active run continues with its snapshot if its source records are edited or deleted. A later run may fail resolution. Storage failure makes new reads, edits, and resolutions fail rather than serving a stale result as current.

## Guarantees and limits

- Model IDs originate from Pi or endpoint discovery and are selected by the agent; there is no editable global model profile or global reasoning allowlist.
- A provider's known Pi models can be listed offline. Endpoint discovery requires a compatible model-list API. Unknown models have conservative metadata and no verified reasoning support. Listing a Pi definition or endpoint-advertised ID does not prove that the configured credentials can call it; a model call establishes that.
- Context budget is snapshotted now; automatic compaction remains a later context-management feature. The model's hard context window is backend metadata, not an editable agent field.
- Existing saved model profiles and agent selections are migrated to connection/model selections where their model can be resolved. Unmappable selections remain incomplete and surface an issue, so users can correct them without a silent model substitution.

## Acceptance examples

1. An editor saves an OpenAI provider connection with a key. The API returns `keyConfigured: true` but never the key. Pi-known OpenAI models appear in its list; an agent selects one and saves reasoning and output limits in its own config.
2. A compatible custom endpoint returns a new model ID. Refresh saves the ID. An agent can select it on a later page load without another provider request; the UI labels its conservative capabilities unverified.
3. A failed refresh leaves the last successful discovered list available. Changing the connection URL makes that old list unavailable until the new endpoint is refreshed.
4. Editing the connection key or the agent's temperature during a run leaves that run's requests unchanged. Its next run uses the new snapshot.
5. A selected model disappears from both Pi and the connection's current discovery list. The agent remains editable, but a new run reports the missing model.
6. An Anthropic-compatible connection uses Anthropic Messages. Refresh reads all pages from `/v1/models` with the Anthropic API version and key, and an agent can call a discovered model through Pi's Anthropic adapter. The editor uses the provider root URL; it does not require a model ID.
7. A DeepSeek connection with the Anthropic Messages protocol and `https://api.deepseek.com/anthropic` can select a Pi-known DeepSeek model. A run sends an Anthropic Messages request to that endpoint, even though Pi's default definition of that model uses OpenAI Chat Completions.
