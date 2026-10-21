# RSI Agent

## Purpose, responsibilities and boundaries

RSI Agent is a local, single-operator application for running teams of AI agents that work together on software projects. The user registers a project directory as a **workspace**; the workspace owns one shared group chat and one team whose lead helps maintain the project design and hands work to the other members. Each member runs through one backend agent loop with its own private execution history, harness and implementation-context documents, while the user reviews design/member changes and activates them separately.

The project owns: the agent runtime and its HTTP/SSE protocol, provider/connection configuration, MySQL persistence, the workspace design and implementation context tree, per-member harnesses and tools, team coordination and shared chat, web search/fetch tools, the React frontend, and the local development/deployment lifecycle scripts. It does not own the user's project source files, their ordinary Git history, their provider accounts, or the host MySQL installation; those are external resources the project operates.

## Interface contract

**Purpose and supported interactions.**

- A user registers project directories as workspaces, chats with each workspace's team, addresses members by mention, inspects folded private work, and reviews and activates design/member changes.
- The user also keeps **solo agents** outside any workspace and manages provider connections from which models are chosen.
- A lead agent proposes design and member changes by editing context and member files; a separate user commit and idle activation make them effective.
- Team members implement accepted designs in the shared checkout, maintain their own implementation context, and report results back into the shared chat.
- Everything is reached through a loopback HTTP API plus SSE streams (agent runs, context change feed, group timeline, commit approval) and a browser frontend; the backend is one Node.js/TypeScript process bound to one MySQL database.

**Required inputs and returned information.** Project boundary at this level receives: registered workspace directory paths and names, workspace model choice lists, user chat text and image attachments, provider connection definitions (endpoint, protocol, optional API key), and the user's accept/deny/feedback and activation decisions. It returns: the registered workspace list, per-workspace design catalog/team/files, group timelines and private run traces, commit-approval requests with diffs, and process/lifecycle status from the scripts.

**Observable effects.** Records are persisted in MySQL (agents, runs, completed messages, model contexts, config records, workspaces, context-base versions and change records, members, group messages and their images). Files are written under each registered project directory (`.rsi/context/design`, `.rsi/context/implement`, `.rsi/members`) and under the project checkout the user reviews. Ordinary Git commits are the only history mechanism; no separate per-member repositories or checkpoints exist.

**Failure behavior and lifecycle.** Every subsystem refuses invalid input atomically and preserves its previous durable state. A refused publication, activation, save or commit changes nothing. Run failures surface as statuses, never as fabricated shared answers. Backend restart marks abandoned runs `interrupted` and preserves committed records, context and files. There is no automatic retry, durable run resumption, multi-user authentication or multi-tenant isolation; the server binds to loopback and acts for the local user.



## Constraints, specifications and requirements

- Node.js 22.19+, TypeScript, MySQL 8.4, and Pi AI `@earendil-works/pi-ai` 0.87.1 as the message/tool/provider format. Pi Agent Core does not run the loop.
- One backend process per database, enforced by an exclusive database session lock; multiple workspaces and multiple frontend followers are supported inside that process.
- The design document tree under `.rsi/context/design` and the implementation-context tree under `.rsi/context/implement` are parallel system hierarchies identified by `metadata.json`; Markdown carries prose, JSON carries only `{implementation: [paths]}`.
- Only the user accepts design and member changes and activates a reviewed member configuration. Agents edit files through scoped tools; Bash deliberately has broader workspace authority as a workflow rule, not a security boundary.
- Ordinary project Git is the history mechanism. Design/member-only commits require user approval; mixed design/member and implementation commits are refused.
- Prototype limits: no workspace rename/deletion, no project-file move/delete/history, no automatic context compaction, no history pagination for agent messages, no public exposure or TLS.

## Subsystems

Each child node states its own purpose, caller-facing interface contract and constraints. This document stays sufficient for callers of the whole application; child internals are not required reading here.

- [Backend](backend/design.md) — the TypeScript/Node.js execution engine: agent runtime loop, MySQL persistence, provider config, workspace/team coordination, harness authority, and HTTP/SSE APIs. Organized into five layers: Foundation, Storage, Domain, API, Runtime.
- [Harness](harness/design.md) — fixed purpose bases, tool selection, file authority and commit approval.
- [Workspace](workspace-agent/workspace/design.md) — workspace registry, project-file API and agent file actions.
- [Context base](workspace-agent/context-base/design.md) — design/implementation context storage, versions and change feed.
- [Team](workspace-agent/team/design.md) — member lifecycle, activation, work routing and member inspection.
- [Group chat](workspace-agent/team/group-chat/design.md) — shared transcript, mentions, mention budget, reservations and reset.
- [Conversation context](workspace-agent/team/conversation-context/design.md) — per-member working-context assembly and automatic retrieval.
- [Frontend](frontend/design.md) — browser UI: conversations, workspace panel, providers, commit approval.
- [Operations](operations/design.md) — local development, host deployment and the shared MySQL lifecycle scripts.
