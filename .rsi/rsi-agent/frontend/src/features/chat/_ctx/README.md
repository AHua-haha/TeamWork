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

## Floating composer placement

Both chat surfaces use `useComposerScrollCollapse` with their viewport and composer refs and expose its state through `data-compact` on the form. Styles reduce only vertical padding and draft height on upward message scrolling; downward gestures or composer focus restore the normal height. Actions and attachments remain available, drafts stay mounted, and the message width is unchanged. Streaming and history-anchor scroll changes do not trigger collapse. Reduced-motion users receive the same state changes without animation.

GroupChat keeps the timeline and transparent sticky composer dock in the same scrolling viewport. The timeline does not shrink; the dock reserves its natural height in the scroll flow. Its horizontal padding aligns the input with the reading column and becomes zero inside narrow viewports, where the viewport already supplies edge padding. A ResizeObserver watches both the timeline and dock, following the bottom only when the existing pinned flag allows it. Solo keeps its existing viewport footer and removes its gradient surface. Both docks ignore pointer events outside their composer boxes, preserving interactions with content underneath.

The composer exposes one round primary icon action. Idle state sends through the existing submission path; a running response shows a pause glyph wired to the existing stop-team/cancel-run action. The group composer no longer renders simultaneous Send and Stop buttons. Empty-input, synchronization and pending-operation restrictions remain enforced, and accessible labels describe the actual send/stop action.

The composer action strip reserves one fixed sidebar-item-height row (32 px by default, using the Shared or application-local sidebar item token). Controls are vertically centered on one line; supporting hints truncate rather than wrapping into a second row. Input text and attachments remain above this reserved row.
