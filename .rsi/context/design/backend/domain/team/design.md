# Domain: Team

## Purpose, responsibilities and boundaries

Team owns the full member lifecycle, group chat transcript, mention routing, activation gating, conversation context assembly, and member response parsing. It decides *who may execute*, *when activation is allowed*, *what a member sees in context*, and *how final answers are selected*.

Team manages member identity, validates member configurations, enforces the atomic activation gate (no active runs, exact revision match, workspace model revision match), routes work through mention headers, tracks per-exchange activation budgets, reserves timeline entries, and assembles each member's working context from shared history, design/impl documents, and private traces.

Team never owns the model loop (that's Agent runtime), never decides file authority (that's Harness), never persists directly (it calls Storage), and never speaks HTTP (that's API). It calls Workspace for design resolution and calls Storage for member records, chat history, and admission state.

## Interface contract

**Purpose and supported interactions.** Team provides:
- Member lifecycle (create, update, retire members with revision control)
- Member configuration validation (validate pending member files before commit)
- Atomic activation (apply a complete reviewed member change set in one transaction)
- Group chat publication (validate mentions/budget, append shared message, create recipient runs)
- Conversation context assembly (working design + impl context + shared/private history)
- Member response parsing (extract final answer with optional body offset from assistant response)
- Chat configuration (set per-exchange activation budget, stop ongoing exchanges)
- Chat snapshot (read shared timeline and change feed for followers)
- Chat reset (clear all shared history and member contexts)
- Image management (store/retrieve workspace-scoped chat images)

**Required inputs and returned information.**
- `validateMemberConfig(workspaceId, files)` — returns validation issues or success (never commits/activates)
- `activateMembers(workspaceId, changeset)` — atomically creates/updates/retires members, requires idle workspace
- `publishChat(workspaceId, sender, content, mentions, images?)` — validates budget/recipients, appends shared message, starts recipient runs
- `prepareMemberContext(agentId, runId, documentEntries)` — assembles model context from shared/private history + docs
- `parseMemberResponse(content)` — extracts mention header and final answer from assistant text
- `chatSnapshot(workspaceId, cursor, position)` — returns shared timeline entries and changes
- `chatImage(workspaceId, imageId)` — returns stored binary and metadata

**Observable effects.** Team calls Storage to persist member records, chat messages, timeline entries, activation markers, and images. It calls Workspace to resolve design nodes and read documents. Member activation waits for user approval and separate UI action. Publication starts runs in Storage but does not execute them (Agent runtime does that).

**Failure behavior.** Busy recipients, stale revisions, budget violations, missing members, duplicate names, invalid mention syntax fail explicitly (`workspace_busy`, `config_conflict`, `member_exists`, `mention_budget_exceeded`, `not_found`). A failed activation or publication writes nothing. Invalid working/dependency design references fail member validation.

## Constraints, specifications and requirements

- Team imports Foundation, Storage interfaces, and Workspace (for design resolution)
- Must not import concrete `MySqlStore`, API, Agent runtime, or Harness
- Member names are unique per workspace among active members; retired members release their names
- Lead is unique per workspace and cannot be retired
- Conversation contexts are scoped per member; shared timeline is workspace-global
- Private history ranges survive run failure and restart; they are cleared on terminal success
- Chat reset is explicit, requires idle workspace, and preserves registry/model settings
- Group admission reserves ordered timeline entries atomically; completion can be out of order
- Accepted final references may include backend-owned bodyOffset into assistant response text
