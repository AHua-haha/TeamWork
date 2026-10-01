# Frontend

React and assistant-ui frontend for the [agent backend](../backend/README.md). The [agent client](src/client/agent-client.ts) owns backend requests, completed Pi records, live Pi events, synchronization, and reconnect recovery. The [adapter](src/adapter/project.ts) derives assistant-ui messages without changing the client data. The [frontend design](../docs/systems/frontend/design.md) describes this boundary.

## Run locally

Start the backend on `127.0.0.1:3000` as described in its README, then run from `frontend/`:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. Vite proxies `/agents` and `/config` to the backend. Set `AGENT_BACKEND_ORIGIN` before `npm run dev` if the backend uses another origin. The Agents page lists agents and opens the global catalog. The catalog has separate **Models**, **Prompts**, and **Tools** tabs. In Models, create a provider connection with a URL, request protocol, and optional API key, then inspect its backend-listed models. The chosen protocol applies to every model on the connection, including Pi-known models. The model ID is owned by the backend and is never entered in the UI. Custom OpenAI-compatible and Anthropic Messages-compatible endpoints can discover and save their model list. Select the provider and model in an agent's Configuration view or the chat composer, where this agent owns reasoning, temperature, output limit, and context budget. **New agent** opens an incomplete agent for setup. App Settings edits the shared application title, input limit, and agent-creation switch.

Composer model and reasoning choices save to the agent config. Advanced call options apply together. The Send control is disabled while a config choice is unsaved or invalid. A run keeps the config it resolved at its start, so edits during a run affect the next run.

The browser sends only new user input. Opening, refreshing, reconnecting, and submitting use the backend's completed-history-first follow API. Each stream closes when its run ends; no periodic polling is used. Missing live chunks are dropped until a completed record arrives. Agent execution and model context stay in the backend.

## Verify

```sh
npm run check
npm test
npm run build
```

The tests cover SSE parsing, completed/live reconciliation, gaps, reconnect, one-run termination, input submission, and Pi-to-assistant-ui conversion. The development UI supports text input; Pi image content received from the backend is displayed. Authentication, history pagination, and local conversation lists are not implemented.
