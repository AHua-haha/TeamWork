<!-- Task proposal; current contract is under docs/systems/ -->
# Workspace agent implementation

## Contract

[Workspace agent design](design.md). The guarantees most exposed to change: every design change is made known to the user; harness context follows the design and survives team changes; the user never needs to follow harness-context maintenance; conversations are disposable; each agent works within its assigned scope and authority.

## Responsibilities and decomposition

The backend's three core systems are the context base, the team, and the agent runtime. The lead and the workers are one kind of agent with different assignments, run by one agent loop. The harness is the contract for executing scoped work and maintaining its knowledge; these three systems compose to fulfill it. Supporting modules retain their existing responsibilities:

| Module | Owns | Responsibilities |
| --- | --- | --- |
| [Workspace](workspace/design.md) | Project files and the environment agents act in | Create, adopt, and list workspaces. Give agents file, command, and version-control actions inside the workspace, and enforce which actions need user approval. |
| [Context base](context-base/design.md) | The workspace's durable context and knowledge | Hold the user's design and subdesigns, and the agent-owned harness context organized around them. Define how context is maintained and accessed, keep versions and change records, and provide scoped views and maintenance operations. Preserve knowledge through changes to the team and design structure. The detailed agent API is designed next. |
| [Team](team/design.md) | Member management and cooperation | Create, configure, change, and retire members. Turn user requests into coordinated work: help the user develop the design and subdesigns, make every design change known to the user, decompose agent work, assign responsibilities, scopes and authority, integrate reports, and raise decisions. The membership and division of work may change throughout a project. |
| Library (later) | Knowledge and roles shared across workspaces | Promote proven knowledge and roles from a workspace and offer them to new workspaces. |
| [Agent runtime](../../../../systems/agent-runtime/design.md) (exists) | Execution of one agent under its harness | Apply the team's assignment rules and the context base's access and maintenance rules to model input, tools, and the execution loop. Provide mechanisms that help an agent work and maintain context effectively within its authority. Record execution separately from durable knowledge. |
| [Frontend](../frontend/design.md) (exists) | The user's screens | Workspaces, conversations with the lead, user context with editing and pending proposals, decision requests, and reports. Agent context is readable on request. |
| [Database](../database/design.md) (exists) | Stored records | Runs and transcripts, plus the workspace registry and the context base's index, versions, and change records. |
| [Config](../../../../systems/config/design.md), [local development](../../../../systems/local-dev/design.md) (exist) | Unchanged roles | Providers and models, and local start-up. |

The harness has two parts, with explicit responsibilities:

- **Work scope and authority**: the team assigns them within the user's design and granted permissions. The runtime applies them to execution, and the context base applies them to its reads and writes.
- **Context maintenance**: the context base defines the durable knowledge model and maintenance operations. The runtime exposes and applies the maintenance mechanisms during an agent's work; the assigned agent keeps its scope's knowledge current. The team preserves continuity when it changes assignments or members.

The team owns decomposition and cooperation; the context base owns durable knowledge; the runtime coordinates their rules during one agent's execution. The earlier separate Harness module for the lead's relationship with the user is superseded by this definition.

## Coordination and data flow

1. **User and lead.** The lead classifies a message, helps the user develop the design and subdesigns, and makes every design change known to the user. The exact presentation and acceptance workflow is still open. Design changes identify affected harness context and work. Questions read the context base. Decision requests raised anywhere in the team reach the user through the lead.
2. **Work loop (lead and team).** To realize the design, the lead updates realization details in harness context, adjusts the team and division of work, and assigns work. An assignment gives the agent its objective, responsibility, scope, authority, references to the relevant design and harness context, and expected result. The runtime activates that agent under its harness; the agent works and maintains that scope's context. Its coordinator integrates and verifies the result against the user's design.
3. **Learning loop.** Knowledge is captured in every report, after a failure is fixed, when the user corrects an agent, and at the end of each task. The context base integrates it with existing knowledge, and views select relevant entries for later assignments. The curator merges, verifies, and retires entries and proposes promotions to the library.

The context base holds harness context organized around the user's design and subdesigns. Each activation obtains the context its assignment needs from it. Assignments, reports, and open decision requests remain there across changes to the team. A split, merge, or reorganization of the design preserves the associated knowledge and its relationships; the representation is designed next. Conversation and run histories record execution; the rules for using them as temporary model context, and for consolidating their useful content, are designed with the runtime harness next.

## Decisions and constraints

- The context base lives in the file system with the workspace, not in agent context, as the user specified.
- Context-base content is divided by owner into user context and harness context. The user's design is the shared contract, and every change is made known to the user. Agents maintain realization details and knowledge freely within their harness. The exact design change and acceptance workflow remains open.
- In the prototype the context base is two file trees with versions, permissions, proposals, and an ordered change feed. Its first API is the frontend's HTTP API; the agent API follows. It leaves folder layout and file formats to its users. Integration, links between the two categories, affected marking, and health checks wait for a designed structure.
- Harness context follows the user's design and subdesigns. The team's division of agent work may change within that design; a change to the user's design structure is made known to the user.
- Workers may be temporary or reused. Harness context persists independently of member identity. An assignment selects existing context; creating a member does not create a new durable knowledge silo.
- The agents' working method is this repository's contract-first protocol: one contract per system, private realization, recursive decomposition, task records, and test evidence.
- The existing runtime keeps its single agent loop. Its context building and maintenance mechanisms will follow the harness rules and the context base's agent API as they are designed.

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
