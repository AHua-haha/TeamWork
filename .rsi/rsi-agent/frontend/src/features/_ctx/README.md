---
summary: User-facing feature workflows for Home, Providers, Chat and Workspace, composed over Shared backend and UI capabilities.
include:
  - frontend/src/features/
  - frontend/src/shared/backend-client/
  - frontend/src/shared/ui/
---

# Features usage contract

Features own browser state, feature-specific mapping and user workflows for the four initial product areas. They call the shared backend facade and may compose Shared UI; durable validity, permissions, scheduling and persistence remain backend responsibilities.

Home starts workspace and conversation entry flows. Providers edits provider connections and discovers models. Chat presents solo and workspace conversations, including composer state, history projection, streaming, cancellation and retry states. Workspace scopes chat tools and read-only context inspection to one workspace.

Feature inputs are navigation state, backend records or streams, and explicit user actions. Outputs are rendered React views and backend requests. Effects are browser state changes and requests initiated by user or lifecycle synchronization. Backend refusals and transport failures are shown in the owning feature where supported, while editable drafts remain available during supported save conflicts.

Example: application composition selects a workspace and renders `WorkspacePage`; the page loads its roster, renders `GroupChat`, and opens Context or activation tools on demand. The feature does not directly implement backend transport or scheduling.

The detailed contracts are maintained in the child design-part READMEs.
