# Frontend implementation

## Contract

[Frontend design](design.md). The agent client owns backend requests, Pi data, synchronization and recovery. The assistant-ui adapter derives display messages and actions without becoming another source of history.

## Responsibilities and decomposition

- The agent client is a UI-independent TypeScript module. It owns an immutable snapshot, a subscription API, SSE parsing, completed-record reconciliation, live Pi partials, run/connection state, and commands.
- The assistant-ui adapter is a React integration that converts each client snapshot into `ThreadMessageLike` values and wires `ExternalStoreRuntime` callbacks.
- `ConfigClient` exchanges app, connection, model-choice, catalog, capability, agent-list, and per-agent config records in the backend's JSON format. API keys are not retained in client records.
- `App.tsx` owns the URL route, two-level shell, agent and connection navigation lists, new conversation creation, and inline renaming. One route to an agent is one conversation. The rail collapse state is view-only; the route remains in the URL.
- `ProvidersPage.tsx` owns the provider overview cards and add/edit dialog. Cards read model choices and refresh them through the config client. The dialog manages a write-only key replacement or explicit clear.
- `ComposerSettings.tsx` owns the cross-connection model picker, compact selected-model view, folded search field, pill reasoning slider, folded More settings section, save state, and Send gate. `model-selection.ts` identifies models by connection plus model ID, reads and replaces one model's `modelOptions` entry, derives the effective reasoning level and its clamped sent level, counts customized fields, and reports per-field misfits against model metadata. A model switch changes only the selected IDs, so every model keeps its own entry.
- `useAgentConfig.ts` owns a current agent-config record and revision-aware saves. Its optional expected revision prevents a stale composer draft from being applied to a newer record.
- `Thread.tsx` renders the conversation and mounts the composer control. `styles.css` owns the light desktop and mobile layouts, including an overlay sidebar on narrow screens.

The app, prompt, tool, and advanced agent configuration editors have no visible page. Their backend data and APIs remain; model and settings writes spread the existing agent record and preserve fields not edited in the composer.

## Coordination and data flow

On mount or refresh, the client opens a run-scoped SSE follow request. Completed records fill its ordered history. The `sync` event establishes that the history is current, then chunks update a Pi partial by replacing it with the event's cumulative Pi `partial`. A `message` event supersedes the partial with the same identity. Gaps and reconnections clear affected partials; an unexpected EOF retries the follow operation using the last completed position. `end` closes the connection and no periodic request is scheduled. A submit POST carries only new user content; its accepted run ID starts another follow request. Leaving a conversation disposes only that frontend follow client; the backend run continues and resynchronizes when the user returns.

App loads agents and connections on mount and refreshes those lists on window focus. Creating a conversation calls the create-agent endpoint, initializes an empty agent config, and opens its chat. Renaming fetches the latest agent config and updates only its name at that revision; the mounted conversation refreshes its config afterward. The provider sidebar contains shortcuts to cards on the single overview page.

Each provider card fetches its backend model choices. Refresh invokes endpoint discovery. Add and edit use the same focused dialog, but edit starts from the connection record returned by the backend. Selecting a known provider preset fills its Pi endpoint and default protocol; the editor may choose another supported protocol and URL. A blank key input means keep the saved key; an explicit clear sends `null`. The dialog never receives the raw saved key. Delete uses the revision-aware endpoint after confirmation.

The composer loads the connections and each connection's choices. Its search icon reveals an initially folded field and the grouped model list. With a selected model, the list starts collapsed; clicking the model summary expands it, and selecting a model folds it again after a successful save. Selection writes `connectionId` and `modelId` together without prompting; switching back shows that model's earlier entry. The popover header shows the effective reasoning level in large text. A transparent native range input over a compact 22px pill track uses integer stops mapping to the backend-listed levels, which are the five-level scale for every reasoning model; pointer release, a reasoning key, or blur after a staged change commits it. Without a saved level the slider shows the backend default and writes nothing; choosing the default while no saved value misfits also writes nothing. `clampedTo` reads the model's `reasoningSentAs`, and the scale row shows "Sent as …" between the end labels when the displayed level is clamped. Zero levels show "No reasoning"; a level saved for such a model is marked and offers to clear it. More settings is keyed by model and starts folded on each open, labeled with the number of customized fields and a needs-attention marker for misfits. Its maximum output tokens, temperature, and context budget inputs show Default with the model's limit when unset, validate staged text against the model, can each be cleared to Default, and save together; context budget is described as stored for future context management. Unsaved More settings edits, a pending, failed, or invalid save, or a selected-model misfit gate sending. A stale revision reloads the latest value for review. The backend still resolves the config snapshot at run start.

## Decisions and constraints

Vite serves React and proxies `/agents` and `/config` to the backend during development. The client uses browser `fetch` and parses the backend's SSE envelopes without depending on React. Backend protocol types are kept in the frontend client boundary with Pi AI types; runtime checks reject malformed envelopes. Assistant UI 0.15 uses `useExternalStoreRuntime`. The display converter associates separate Pi tool-result records with preceding tool-call parts and preserves source records in the client. CSS supplies a light palette for all states and viewport sizes. No frontend tool execution or model-context submission is enabled.

The secondary Config panel lists provider connections as shortcuts because Providers is the only config page. Larger cards use one readable column; the model list expands inside a card. On mobile the secondary panel overlays content and starts closed. Closing it does not change the URL or the active agent run. Hidden prompt, tool, and app editors are not replaced by another general settings view; model-call settings live only in the composer popover. The Providers page holds connection information only.

The picker labels duplicate model IDs and names with their connection, never assuming a model ID is globally unique. The slider's integer step prevents unsupported intermediate reasoning values from reaching the backend. The frontend displays the backend's sent-level mapping and does not compute clamping itself. A provider model list does not prove the configured credential can make a model call.

## Code map

- [Client protocol](../../../frontend/src/client/protocol.ts), [SSE parser](../../../frontend/src/client/sse.ts), and [agent client](../../../frontend/src/client/agent-client.ts): backend-format data and commands.
- [Config client](../../../frontend/src/client/config-client.ts): backend-format config data and requests.
- [Pi projection](../../../frontend/src/adapter/project.ts) and [assistant-ui runtime](../../../frontend/src/adapter/AssistantRuntime.tsx): display conversion and UI action delegation.
- [App shell](../../../frontend/src/ui/App.tsx), [conversation view](../../../frontend/src/ui/Thread.tsx), and [styles](../../../frontend/src/ui/styles.css): navigation, conversation, and layout.
- [Provider overview](../../../frontend/src/ui/ProvidersPage.tsx), [composer config](../../../frontend/src/ui/ComposerSettings.tsx), [model selection](../../../frontend/src/ui/model-selection.ts), and [agent config hook](../../../frontend/src/ui/useAgentConfig.ts): config editing and save coordination.
- [Client tests](../../../frontend/test/client.test.ts), [config client tests](../../../frontend/test/config-client.test.ts), [model selection tests](../../../frontend/test/model-selection.test.ts), and [adapter tests](../../../frontend/test/adapter.test.ts): contract verification.
- [Vite config](../../../frontend/vite.config.ts), [HTML entry](../../../frontend/index.html), [favicon](../../../frontend/public/favicon.svg), [package](../../../frontend/package.json), and [README](../../../frontend/README.md): development and use.

## Verification

TypeScript check and production build verify the package integration. Client tests cover completed/live reconciliation, chunk gaps, reconnect, failure, cancellation, one-run stream termination, config revision transport, and conflict errors. Model-selection tests check connection-scoped identity, per-model entries kept across switches, clearing fields to defaults, the effective reasoning default, clamped "sent as" levels, and misfit detection. Adapter tests cover content/status/tool conversion and preservation of raw Pi records. A browser pass checks desktop and mobile navigation, provider cards and dialog, composer model and reasoning popovers, and console errors. This task's runs are recorded in the [task verification log](../../tasks/2026-10-01-frontend-refinement/tests.jsonl).
