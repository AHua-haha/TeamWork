---
summary: Landing actions for adding a workspace or starting a conversation without a workspace.
include:
  - frontend/src/features/home/HomePage.tsx
  - frontend/src/app/
  - frontend/src/shared/backend-client/
---

# Home usage contract

`HomePage` renders the landing actions supplied by application composition. It accepts `onAddWorkspace`, `onNewConversation`, `creating`, and `allowCreation`; it does not load workspace records or own creation persistence.

Add workspace invokes the supplied callback. New conversation invokes its callback only when creation is allowed and no creation is in progress. The component renders the disabled state from those inputs and otherwise leaves navigation, dialogs, backend requests and failure handling to its parent.

Inputs are callback functions and creation flags. Output is the landing view and callback effects. There is no durable local state or direct backend call.

Example:

```tsx
<HomePage onAddWorkspace={openWorkspaceReview} onNewConversation={startConversation} creating={busy} allowCreation={canCreate} />
```

The broader Home design permits workspace list/overview presentation; the current implementation is an entry-point action view, so list loading and workspace selection are composed elsewhere.
