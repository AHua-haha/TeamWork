<!-- Task proposal; current contract is under docs/systems/ -->
# Workspace agent implementation

## Contract

[Workspace agent design](design.md). The guarantees most exposed to change: user context changes only through the user, and the user never needs agent context; conversations are disposable; each agent sees only its scope; agents act only inside the workspace and its permissions.

## Responsibilities and decomposition

The lead and the workers are one kind of agent with different roles, run by one agent loop. The modules divide by what they own:

| Module | Owns | Responsibilities |
| --- | --- | --- |
| [Workspace](workspace/design.md) | Project files and the environment agents act in | Create, adopt, and list workspaces. Give agents file, command, and version-control actions inside the workspace, and enforce which actions need user approval. |
| [Context base](context-base/design.md) | The workspace's memory | Hold user context and agent context as file trees. Let only the user change user context and agents change agent context within their scopes. Keep every version, hold the lead's proposals to change user context, and record every change in order. Serve the frontend over HTTP. The agent API is designed later. |
| Harness | The relationship with the user | Conversations with the lead, message classification, consolidation of requests into proposals to user context, proactive review and suggestions, conflict presentation, decision requests in the user's terms, the scoped-freedom rule, moving the review boundary, and reports per spec item. |
| [Team](team/design.md) | The agents and their organization | Roles, workers, responsibilities, and scopes; splitting context among workers; assignments, reports, escalations, and contract-change requests; team changes; activation and limits. |
| Library (later) | Knowledge and roles shared across workspaces | Promote proven knowledge and roles from a workspace and offer them to new workspaces. |
| [Agent runtime](../../../../systems/agent-runtime/design.md) (exists) | Execution of one agent | Run an activation of the lead or a worker: build the model context from the context base, offer the tools its role permits, and record the run. Its stored message history becomes a log rather than memory. |
| [Frontend](../frontend/design.md) (exists) | The user's screens | Workspaces, conversations with the lead, user context with editing and pending proposals, decision requests, and reports. Agent context is readable on request. |
| [Database](../database/design.md) (exists) | Stored records | Runs and transcripts, plus the workspace registry and the context base's index, versions, and change records. |
| [Config](../../../../systems/config/design.md), [local development](../../../../systems/local-dev/design.md) (exist) | Unchanged roles | Providers and models, and local start-up. |

Each principle has one owning module, supported by others:

- **Harness**: the Harness module, supported by the context base's proposals and acceptance.
- **Decompose**: the Team module, supported by the context base's scopes and views.
- **Consolidate and reuse**: the context base's knowledge and integration, supported by the capture duty in every role and by the curator role.

## Coordination and data flow

1. **Harness loop (user and lead).** The lead classifies a message. Anything to record in user context, whether the user stated it or the lead drafted it, becomes a proposal and is recorded when the user accepts it. The lead receives every change to user context, whether accepted or edited directly. It turns the agent context each change affects into work. Questions read the context base. Decision requests raised anywhere in the team reach the user through the lead, and the lead proposes the answers for user context.
2. **Work loop (lead and team).** For an accepted change, the lead updates the design, adjusts the team when the work or a scope has outgrown it, and assigns work. Each worker activates with its scoped view, works in the workspace, and returns a report or an escalation. Its coordinator integrates and verifies the result against the contract, and progress is updated per spec item.
3. **Learning loop.** Knowledge is captured in every report, after a failure is fixed, when the user corrects an agent, and at the end of each task. The context base integrates it with existing knowledge, and views select relevant entries for later assignments. The curator merges, verifies, and retires entries and proposes promotions to the library.

The context base is the only memory. Every activation of the lead or a worker starts from the context base. Conversation and run histories are logs that nothing reads back to continue work. Assignments, reports, and open decision requests are recorded in agent context, so a restart loses no coordination state.

## Decisions and constraints

- The context base lives in the file system with the workspace, not in agent context, as the user specified.
- Context-base content is divided by owner into user context and agent context. The user owns what the user knows and decides, and agents own everything else. Agents help with user context only through proposals. This keeps the shared model between the user and agents small, as the contract-first protocol requires.
- In the prototype the context base is two file trees with versions, permissions, proposals, and an ordered change feed. Its first API is the frontend's HTTP API; the agent API follows. It leaves folder layout and file formats to its users. Integration, links between the two categories, affected marking, and health checks wait for a designed structure.
- The decomposition of agents follows the decomposition of the project. A worker's scope is a set of systems in the design, and contracts form the boundaries of each worker's context.
- Workers persist across assignments. Their expertise lives in their scope of the context base, not in a conversation.
- The agents' working method is this repository's contract-first protocol: one contract per system, private realization, recursive decomposition, task records, and test evidence.
- The existing runtime keeps its single agent loop. Context building moves from stored message history to the context base, through an agent API designed later.

## Code map

Built so far: the workspace registry with its project-file view, the context base's frontend API without proposals, and the team: members stored per workspace, the lead, the run part, and the lead's management tools. Members work in the workspace through Pi's file tools, with their scope enforced in the file operations, so the context base has no agent API yet. The frontend adds workspaces, opens each workspace's lead conversation, and shows the team and the files in a panel. The harness, library, agent API for the context base, proposals, search for agents, and commands are designed but not built.

- [Workspace implementation](workspace/impl.md): registry, project files, the files an agent works on, and the `/workspaces` routes.
- [Team implementation](team/impl.md): members, the lead created with its workspace, calls between members, the member tools, and the instructions each model call starts with.
- [Context base implementation](context-base/impl.md): current files on disk, versions, change records, outside changes, and follow.
- [Database implementation](../database/impl.md): the workspace and context-base tables.
- [Agent runtime implementation](../agent-runtime/impl.md): the server that carries the workspace routes, and the shared change notification.
- [Frontend implementation](../frontend/impl.md): the workspace panel.

## Verification

Each child implementation lists its tests. This task's runs are recorded in the [task verification log](../../tests.jsonl).
