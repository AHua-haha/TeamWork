# Frontend

React and assistant-ui frontend for the [agent backend](../backend/README.md). The [agent client](src/client/agent-client.ts) owns backend requests, completed Pi records, live Pi events, synchronization, and reconnect recovery. The [adapter](src/adapter/project.ts) derives assistant-ui messages without changing the client data. The [frontend design](../docs/systems/frontend/design.md) describes this boundary.

## Run locally

Start the backend on `127.0.0.1:3000` as described in its README, then run from `frontend/`:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. Vite proxies `/agents`, `/config` and `/workspaces` to the backend. Set `AGENT_BACKEND_ORIGIN` before `npm run dev` if the backend uses another origin. The icon rail has **Conversations** and **Config** sections. Its secondary sidebar can collapse; on mobile it overlays the current page. Each conversation is one backend agent. **New conversation** creates the agent and opens its chat, where a model can be selected before sending.

Config shows provider connections as cards. Add and Edit use a dialog for the connection name, provider, protocol, endpoint URL, and optional write-only API key. Expanding a card shows its backend-listed models, and Refresh asks the endpoint for model choices. The composer lists models from all connections when its selected model is expanded; the search field starts folded behind an icon. Selecting a model also selects its connection, then folds the list. Settings are saved per conversation and per model: a stepped slider offers Off, Low, Medium, High, and XHigh for every reasoning model, with a "Sent as" note when the model uses its nearest supported level instead, and a folded More settings section edits maximum output tokens, temperature, and context budget. Unset values use the model defaults and are not written until changed. Hidden prompt and tool settings remain saved but have no editor in this UI revision. Send is disabled while a config choice is unsaved or invalid. A run keeps the config it resolved at its start, so edits during a run affect the next run.

The browser sends only new user input. Opening, refreshing, reconnecting, and submitting use the backend's completed-history-first follow API. Each stream closes when its run ends; no periodic polling is used. Missing live chunks are dropped until a completed record arrives. Agent execution and model context stay in the backend.

## Verify

```sh
npm run check
npm test
npm run build
```

The tests cover SSE parsing, completed/live reconciliation, gaps, reconnect, one-run termination, input submission, Pi-to-assistant-ui conversion, and cross-connection model selection. The development UI supports text input; Pi image content received from the backend is displayed. Authentication and history pagination are not implemented.

## Current design and team views

Open **Show design, team and files** on a workspace page. **Design** opens first and shows current designs, Markdown, implementation mappings and related members. **Team → Active members** shows a design folder/file tree with member cards attached at their working designs, and the lead at the workspace root. Hover or keyboard-focus an avatar for scope/harness preview; click/tap for full **active-only** details, including exact accepted JSON/Markdown, model settings and effective Management/Implementation/Execute rules. On narrow panels, Close returns from details to the tree. **Team → Configuration changes** shows independent status/history and Commit/Activate controls above a flat changed-file list and unified text diff. Commit accepts pending files without changing active members; Activate applies reviewed committed configuration while the whole workspace is idle, preserving additional pending edits. Discuss configuration edits with the lead; no structured member editor is provided. **Workspace models** edits workspace choices/default with revision protection. Add workspace requires these choices and initializes its lead from the default. Existing file review stays available.

Design/member links navigate between views. Implementation links open a file or reveal a directory in **Files**. **Discuss with lead** adds a removable reference to the composer and preserves existing typed text; the user submits explicitly. Current design content follows context updates. New design-version and diff interfaces are deferred; generic file editing/history stays available.

## Streaming group replies

Active members stream text and tool activity in one ordered flow, initially visible through **Work**. Thinking stays hidden. Consecutive tool calls form collapsible groups, including across tool-only messages; visible text separates them. Each tool row can show its full arguments and result. The private follow API reads whole SQL Pi records and version-2 compact in-memory progress without cumulative partials or a special response annotation. The client reconstructs block deltas incrementally and recovers evicted starts through SQL history or the next message start. Accepted group publication identifies the exact final text blocks, folds earlier work once, and keeps the full final report visible in the same reserved section. Reopening Work excludes that final and shows no placeholder when empty. Manual folding keeps active updates running and preserves tool disclosure choices. Reconnect/reload reconstructs the flow from backend records, and streaming follows the bottom only while you are already there.
