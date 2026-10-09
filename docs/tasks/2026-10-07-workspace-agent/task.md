# 2026-10-07-workspace-agent

Status: active
Task start commit: 869ee1452c17051030f0429bdd389ac800dcb2df
Review boundaries: [Workspace agent](drafts/workspace-agent/design.md), [workspace](drafts/workspace-agent/workspace/design.md), [context base](drafts/workspace-agent/context-base/design.md), [team](drafts/workspace-agent/team/design.md), [frontend](drafts/frontend/design.md), [config](drafts/config/design.md), [database](drafts/database/design.md)

## Design outcomes

- [planned] Turn the single-conversation agent into a workspace agent: the user works with a lead agent on a project, requests become the workspace's spec, and agents do the work within it. See [workspace agent design](drafts/workspace-agent/design.md); modules and responsibilities in [its implementation draft](drafts/workspace-agent/impl.md).
- [delivered in part] Give each workspace a context base: persistent, file-based memory in two categories, user context and agent context, with versions, proposals, and an ordered change feed, served to the frontend over HTTP. The agent API is designed later. See [context base design](drafts/workspace-agent/context-base/design.md). The frontend API without proposals is delivered and canonical at [docs/systems/workspace-agent/context-base](../../systems/workspace-agent/context-base/design.md); proposals and the agent API are still planned.
- [delivered] Register workspaces and let the frontend browse and edit the project's own files. Canonical at [docs/systems/workspace-agent/workspace](../../systems/workspace-agent/workspace/design.md); draft in [workspace design](drafts/workspace-agent/workspace/design.md).
- [delivered] A workspace panel in the frontend: a sidebar that slides in from the right, opened from the conversation header. Open files appear in tabs, the center shows the file as a preview or plain text, and one file tree for the project files and the context base floats at the panel's right edge. Canonical in the [frontend design](../../systems/frontend/design.md); draft in [frontend draft](drafts/frontend/design.md).
- [delivered] Each agent conversation works in one workspace, chosen once in the panel and kept in the agent's config; a conversation without one cannot run. Canonical in the [config design](../../systems/config/design.md) and the [frontend design](../../systems/frontend/design.md); drafts in [config](drafts/config/design.md) and [frontend](drafts/frontend/design.md).
- [planned] Let the lead form a team while talking with the user: create persistent workers, set their roles and responsibilities, split the context among them by scope, and coordinate their work. See [team design](drafts/workspace-agent/team/design.md).

## Decisions and open questions

- The user's three principles: harness (the user works only with spec and design; agents have scoped freedom below them), decompose (split a big project into systems handled by agents with scoped context), and knowledge consolidation and reuse.
- Each workspace has its own context base, persisted in the file system rather than in agent context.
- Decomposition is a team mechanism rather than a one-shot delegate tool. During the conversation the lead creates workers, sets each worker's role and responsibility, and splits the context among them.
- This discussion settles what the system does, its modules, and their responsibilities. Implementation detail and the context base's file structure are deferred.
- 2026-10-07: context-base content is divided by owner.
  - User-owned content is what the user knows and decides: goals, spec, constraints, and preferences. Agents help draft, suggest, refine, and improve it, but it stays user-owned and changes only with the user's acceptance.
  - Agent-owned content is what the user does not need to know: design below the review boundary, work, evidence, team, and agent knowledge.
  - The review boundary is the line between the two parts. The user can take over or hand over topics.
- 2026-10-07: the prototype context base has two categories only.
  - User context maintains the user's information. Agent context maintains what agents own while working on the project.
  - The structure and format of context-base files are left open. The design covers the API the context base gives its callers: an HTTP API for the frontend to view and edit the files, and tools for agents.
  - The two categories are now called user context and agent context (previously user-owned and agent-owned content).
- 2026-10-07: this round designs only the context base's HTTP API for the frontend. The agent API is deferred: how agents read context, write agent context, create and withdraw proposals, and are limited by scope, and what an activation starts with. The frontend API shows agents' results as files, versions, change records, and proposals.
- 2026-10-07: changes made outside the application reach the change feed promptly. Opening a workspace scans its files for changes made while the backend was not watching. While it is open, a file watcher records outside changes. Recording on the next read or list remains the fallback.
- 2026-10-07: build the context base's frontend UI now, backend and frontend together.
  - Proposals are deferred. The user edits user context directly; agent context stays read-only.
  - The workspace view is a sidebar on the right that slides in, as in the user's reference screenshots. Its file tree shows both the project files and the context base.
  - Files open in a preview, with a plain-text editor for edits. Markdown previews render a safe subset: no raw HTML, and images show their alt text.
  - Because the tree shows project files, the Workspace module serves them (settles open item 11): list, read, save, create, and find, guarded by content-hash revisions. It offers no move, delete, or live updates, and hides `.git` and `.context`.
- 2026-10-07: each agent conversation relates to one workspace. The panel's trigger moves to the right of the chat page's header. The panel follows the user's reference screenshots: tabs and panel actions on top, a breadcrumb with view and copy actions above the file, the preview or plain text in the center, and the file tree with a filter floating at the right.
- Agent choices in the drafts, for review:
  - Workspace binding: the conversation's workspace is stored in its agent config. A new conversation starts without one and the user chooses it in the panel; it can be set once and never changed or cleared, so another workspace takes a new conversation. Until it is chosen the conversation reports an issue and cannot run, and the issue banner offers Choose workspace. A workspace created from the chooser is selected but not bound until the user confirms. Conversations saved before this change read with no workspace. The run snapshot does not carry the workspace yet.
  - Panel: the header button shows only while the panel is closed, and the panel bar has Expand and Hide. Whether the panel is open or expanded carries across conversations; its contents belong to each conversation. Expand hides the chat on wide screens. The panel overlays the page at 1100 px and below, at `min(880px, 100vw − 64px)`, or `100vw − 64px` expanded; at 760 px and below it is `100vw − 56px` with no Expand, and the tree covers the file view and hides when a file opens.
  - Tabs: each file opens once in its own tab, all tabs stay loaded so background drafts survive, and tabs are not remembered or reorderable. Closing a tab with unsaved changes asks first, and so does leaving a conversation with unsaved changes. Deleting a file closes its clean tabs; a tab with unsaved changes stays and can save the file again. The tree can be hidden and shown; "+" in the tab bar shows the tree and focuses its filter.
  - Files: a new file starts empty and opens in the editor; a move never replaces an existing path; a stale save shows a conflict banner that keeps the draft; restoring a version saves its content as a new version; limits of 2,000 tree entries, 200 find results, and 100 search matches; no drag-resize and no content-search UI in this revision.
- Open, with the recommendation written into the drafts:
  1. Spec approval (revised for the API): agents never write user context. Every agent change to it is a proposal that the user accepts, possibly with edits, or rejects. This includes recording what the user said directly. A proposal is accepted or rejected whole; related changes go in one proposal. This replaces the earlier recommendation that the lead records the user's direct statements once restated.
  2. Team control: team changes need no user approval; the team is visible and the user can ask for changes.
  3. Worker creation: only the lead creates and changes workers in the prototype; coordinators assign work within their part.
  4. Context base location: inside the project directory and versioned with it.
  5. User edits to agent context (revised for the API): agent context is read-only in the frontend, and the user tells the lead instead. Edits made outside the application, for example in an editor or by `git checkout`, are recorded as external versions.
  6. Agent observations about the user, such as "prefers compact layouts", stay agent knowledge until the user confirms them as preferences.
  7. Prototype limits: software projects whose acceptance examples can be checked by commands; one worker runs at a time; the user talks only to the lead.
  8. Proposal authors: only the lead proposes changes to user context. Workers report what they need to their coordinator.
  9. Visibility: every agent reads all of user context. Agent context is visible to a worker only within its scope, which is a set of agent-context paths.
  10. Content: text files only, up to 1 MiB each by default.

## Checkpoints and remaining work

- Drafted the top-level design, module responsibilities, context base design, and team design for review. No code changes.
- Reworked the context base design around user-owned and agent-owned content, and aligned the workspace, team, and module drafts with it.
- Simplified the context base to two categories and drafted its API: the workspace operations it depends on, the HTTP API for the frontend, the tools for agents, the permission rules, proposals, the change feed, and the activation context. Aligned the workspace, team, and module drafts with the new terms. No code changes.
- Narrowed the context base draft to the frontend HTTP API. Removed the agent tools and the activation context, rewrote the acceptance examples from the frontend's side, and added history paging and a JSON delete with a reason. No code changes.
- Added the scan on opening a workspace and the file watcher for outside changes. No code changes.
- Delivered in the first partial commit:
  - backend: the workspace registry and project-file API; the context base with current files on disk, MySQL index, versions, and change records, outside changes, and follow; the `/workspaces` routes on the agent server; and HTTP helpers shared by all routes;
  - frontend: the workspace client and the right-hand workspace panel with tree, preview, editor, history, moves, deletes, and the live change feed;
  - drafts for the workspace, context base, database, agent runtime, and frontend.
- Also in the first partial commit, binding each conversation to one workspace and reworking the panel:
  - backend config: `workspaceId` in agent config, checked against the registry, set once, and reported as an issue while missing; integration tests for the binding;
  - frontend: the workspace chooser in the panel, the header trigger, the Choose workspace action in the issue banner, files in tabs with the breadcrumb header and icon actions, the floating tree column, Expand, and the leave guard for unsaved changes;
  - drafts: a new config draft and updated frontend drafts.
- Promoted to `docs/systems/` in that commit: the workspace and context base designs and implementations (under `workspace-agent/`), and the config, database, agent runtime, and frontend documents. The parent workspace agent design and implementation and the team design stay proposals under `drafts/` because the harness and team are not built, so `docs/systems/workspace-agent/` holds only its two delivered children for now.
- Test evidence: [task verification log](tests.jsonl). The candidate's type checks, unit tests, and builds were run through the logger on 2026-10-09, and the MySQL integration tests, including the workspace binding, passed on the user's machine on 2026-10-07 with the same code. The watcher test is skipped in the agent's sandbox, which refuses file events.
- Next: the user runs the unit tests locally, which include the watcher test, and reviews the chooser and the panel in a browser. Proposals, the agent API, the harness, and the team follow in later commits.
