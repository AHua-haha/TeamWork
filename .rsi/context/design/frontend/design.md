# Frontend

## Purpose, responsibilities and boundaries

The frontend is the browser application the user works in: it registers and browses workspaces, chats with a workspace's team and inspects folded member work, reads the project design and implementation mappings, browses and edits the workspace's files, holds a private conversation with a solo agent, and manages the provider connections models are chosen from.

It owns presentation, navigation, addresses/routes, request orchestration and client-side recovery. It does not own the agent's model-facing context, execution, durable group ordering, file authority or approval decisions: the backend persists and decides those, and the frontend reads them through the agent, config, workspace, context-base and team APIs. It never parses a transcript to infer authority.

## Interface contract

**Purpose and supported interactions.** The user reaches everything from a two-destination rail (**Conversations**, **Config**). Conversations holds workspaces and solo agents in a secondary sidebar; a workspace page composes shared group chat plus a right-hand panel with permanent **Design**, **Team**, **Changes** and **Files** tabs and open file tabs; a solo page composes a private conversation. Config is a single provider overview with per-connection cards and add/edit dialogs. A compact commit-approval control appears above the composer when a member's commit needs a decision, and Review opens its diff in the panel.

**Required inputs and returned information.** The frontend consumes registered workspaces, per-workspace team, design catalog with mappings, context-base overview/tree/files/versions/records and the change feed, project file listings, group timeline and reservation changes, commit-approval summaries and diffs, solo agent configs with revisions and issues, provider connections and model choices, and per-run SSE streams. It submits workspace registration, file saves, chat text and images, model and reasoning choices, member model settings, approval decisions and member activation requests.

**Observable effects.** Saving a file writes the workspace; sending a message starts member work; an approval decision resolves the waiting Bash call; an activation makes a reviewed member configuration current. The UI reflects backend-confirmed results only, keeps unsaved drafts in their tab, and does not optimistically apply history changes.

**Failure behavior and lifecycle.** Connection loss is shown separately from run failure; an unexpected stream end never establishes completion. Sync-then-follow and cursor-based reconnection prevent duplicates and skipped records; a refused save, send, decision or activation keeps the draft and shows the backend's reason. Unavailable models or invalid settings block Send rather than silently substituting values. Leaving a workspace page with unsaved edits asks first, and closing a tab with unsaved edits asks to discard them.

## Constraints, specifications and requirements

- Client modules are UI-independent where they own protocol (`agent-client`, `group-client`, `workspace-client`, `changes-client`, `config-client`, `commit-approval`, `sse`, `protocol`); React components derive display from those snapshots without becoming another source of history.
- Rendering is light and restrained: compact rail, contextual secondary sidebar, large content area, slide-in workspace panel; desktop, tablet and narrow layouts all keep message content in a constrained reading column.
- Markdown is rendered through the project's own parser; raw HTML shows as text, images show alt text, and links stay inside the context root or workspace unless they are web/mail links.
- No provider API key value is ever displayed or retained client-side; the key is write-only to the backend.
- This revision exposes no editors for app settings, tools or prompt templates; their saved backend values remain intact.

## Subsystems

- [Group chat](group-chat/design.md) — the workspace chat presentation contract: reserved member sections, folded private work, tool sets, thinking indicator, images, approval popup and reset.
