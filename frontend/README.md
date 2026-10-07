# Frontend

React and assistant-ui frontend for the [agent backend](../backend/README.md). The [agent client](src/client/agent-client.ts) owns backend requests, completed Pi records, live Pi events, synchronization, and reconnect recovery. The [adapter](src/adapter/project.ts) derives assistant-ui messages without changing the client data. The [frontend design](../docs/systems/frontend/design.md) describes this boundary.

## Run locally

Start the backend on `127.0.0.1:3000` as described in its README, then run from `frontend/`:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. Vite proxies `/agents` and `/config` to the backend. Set `AGENT_BACKEND_ORIGIN` before `npm run dev` if the backend uses another origin. The icon rail has **Conversations** and **Config** sections. Its secondary sidebar can collapse; on mobile it overlays the current page. Each conversation is one backend agent. **New conversation** creates the agent and opens its chat, where a model can be selected before sending.

Config shows provider connections as cards. Add and Edit use a dialog for the connection name, provider, protocol, endpoint URL, and optional write-only API key. Expanding a card shows its backend-listed models, and Refresh asks the endpoint for model choices. The composer lists models from all connections when its selected model is expanded; the search field starts folded behind an icon. Selecting a model also selects its connection, then folds the list. Settings are saved per conversation and per model: a stepped slider offers Off, Low, Medium, High, and XHigh for every reasoning model, with a "Sent as" note when the model uses its nearest supported level instead, and a folded More settings section edits maximum output tokens, temperature, and context budget. Unset values use the model defaults and are not written until changed. Hidden prompt and tool settings remain saved but have no editor in this UI revision. Send is disabled while a config choice is unsaved or invalid. A run keeps the config it resolved at its start, so edits during a run affect the next run.

The browser sends only new user input. Opening, refreshing, reconnecting, and submitting use the backend's completed-history-first follow API. Each stream closes when its run ends; no periodic polling is used. Missing live chunks are dropped until a completed record arrives. Agent execution and model context stay in the backend.

## Verify

```sh
npm run check
npm test
npm run build
```

The tests cover SSE parsing, completed/live reconciliation, gaps, reconnect, one-run termination, input submission, Pi-to-assistant-ui conversion, and cross-connection model selection. The development UI supports text input; Pi image content received from the backend is displayed. Authentication and history pagination are not implemented.
