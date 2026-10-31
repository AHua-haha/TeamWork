---
summary: Solo and team conversation presentation with assistant-ui composition, live agent state, sending and explicit cancellation.
include:
  - frontend/src/features/chat/
  - frontend/src/shared/backend-client/
  - frontend/src/shared/ui/
---

# Chat usage contract

`ChatPage` creates and follows an agent client for a solo conversation, gates sending on configuration readiness, and supplies `Conversation` with settings, files and optional discussion reference controls. `GroupChat` provides the workspace/team variant and consumes the lightweight roster supplied by Workspace. Solo conversation layout uses a local copy of the Shared thread geometry: 724 px content width where available, 14 px text with 1.65 line height, and avatar space outside the message content width. The local copy preserves the application's existing color palette.

Chat projects synchronized backend snapshots into rendered messages. The composer sends text and optional discussion references through the shared client; cancellation is an explicit user action. Running state, stream progress, stable history, errors, retries, images and model/configuration controls are rendered by the chat components. Transient progress is not promoted to stable history until backend state confirms it, and navigation/disconnect does not cancel backend work.

Inputs are agent or workspace identity, configuration state, backend snapshots/SSE updates, user text or images, history cursors and roster state. Outputs are conversation views and send/cancel requests. A send is disabled while synchronization, configuration loading/saving, another send or a run prevents it. Backend refusals and connection failures remain visible through the conversation state; editable composer input is preserved where the underlying assistant-ui flow supports it.

Example:

```tsx
<ChatPage agentId={agentId} control={settings} api={config} eyebrow="CHAT"
  title="Assistant" onRunning={setRunning} />
```

Group history uses bounded latest-page loading, cursor-based updates and explicit older-page requests as specified by the Chat design. The feature does not own scheduling, execution policy or durable conversation authority.
