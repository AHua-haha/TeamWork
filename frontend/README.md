# Frontend

React and assistant-ui frontend for the [agent backend](../backend/README.md). The [agent client](src/client/agent-client.ts) owns backend requests, completed Pi records, live Pi events, synchronization, and reconnect recovery. The [adapter](src/adapter/project.ts) derives assistant-ui messages without changing the client data. The [frontend design](../docs/systems/frontend/design.md) describes this boundary.

## Run locally

Start the backend on `127.0.0.1:3000` as described in its README, then run from `frontend/`:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. Vite proxies `/agents` to the backend. Set `AGENT_BACKEND_ORIGIN` before `npm run dev` if the backend uses another origin. The app creates an agent on first open and keeps its ID in the URL so a refresh loads the same conversation. Use **New agent** to start another session.

The browser sends only new user input. Opening, refreshing, reconnecting, and submitting use the backend's completed-history-first follow API. Each stream closes when its run ends; no periodic polling is used. Missing live chunks are dropped until a completed record arrives. Agent execution and model context stay in the backend.

## Verify

```sh
npm run check
npm test
npm run build
```

The tests cover SSE parsing, completed/live reconciliation, gaps, reconnect, one-run termination, input submission, and Pi-to-assistant-ui conversion. The development UI supports text input; Pi image content received from the backend is displayed. Authentication, history pagination, and local conversation lists are not implemented.
