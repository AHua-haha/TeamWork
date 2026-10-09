<!-- Task proposal; current contract is under docs/systems/ -->
# Team

## Purpose and boundary

The team is how a workspace's work is divided among agents. While the lead talks with the user, it forms and changes the team: it creates workers, gives each a role and a responsibility, and splits the workspace's context among them by giving each a scope. It then assigns work and receives reports. Each worker works with only its own part of the context.

The team does not run model loops, store content, or decide what the user wants. Those belong to the agent runtime, the context base, and the user. The team is recorded in agent context: the user never needs to manage it, and can shape it only by stating a constraint or preference, such as "always have a reviewer".

## Inputs and preconditions

**Roles.** A role defines a kind of work: its purpose, how it is done, what the agent may change, and what it must report. The built-in roles are:

| Role | Does | May change |
| --- | --- | --- |
| Lead | Works with the user, drafts and improves user context through proposals, designs the top level, forms the team, coordinates and verifies | Proposals and decision requests to the user, all agent context, including the top-level design and the team |
| Owner | Keeps its systems' contracts true: designs below them, implements, tests, and captures what it learns | Its systems' design and project files, its work, and agent knowledge |
| Reviewer | Checks results against contracts and user context independently of whoever produced them | Evidence and findings only |
| Researcher | Investigates questions such as libraries, APIs, or existing code | Agent knowledge and findings only |
| Curator | Keeps agent knowledge consolidated: merges, verifies, and retires entries and proposes promotions | Agent knowledge only |

The lead may define further roles with the same fields.

**Workers.** A worker is a persistent team member with a name, a role, a responsibility, a scope, the member it reports to, and a status. It keeps its identity across assignments. Its memory is its scope in the context base, so each activation starts a fresh conversation without losing anything.

**Responsibility.** A worker's responsibility states what it is accountable for: the outcomes it delivers, what it must keep current, and when it must escalate. For example: "Keep the config system's contract true and verified; own every change to it; raise contract risks to the lead."

**Scope and context split.** An owner's scope is one or more systems in the design. Each system has exactly one owner at all times, and the lead owns every system it has not assigned. Reviewers, researchers, and curators own no systems; their scope lists the systems they may read.

The lead splits the context by giving each system its own place in agent context, a folder or a set of files. A worker's scope, which the context base enforces, then consists of:

- the paths of its own systems, which it may write;
- the paths it may only read: other systems' contracts and the knowledge relevant to it.

Every worker reads all of user context. The rest of agent context is hidden from it.

## Outputs and observable effects

### Forming the team

The lead uses these operations at any point in a conversation, on its own judgment or at the user's request:

- **Create** a worker with a role, responsibility, scope, and reporting line. Its systems transfer from their current owner.
- **Change** a worker's role, responsibility, or scope.
- **Split** a scope that has outgrown one worker. The lead divides the system into child systems in the design and moves their agent context to their own paths, and each part gets an owner: a new worker, or the current owner for one part. The previous owner becomes the coordinator of the parts.
- **Merge or retire.** A worker's systems return to its coordinator and the worker is retired. Nothing is lost, because its memory is in the context base.
- **Define** a role.

Every team change is recorded with its reason. Team changes need no user approval.

### Working

- **Assign.** A coordinator gives a worker an assignment: a goal tied to spec items or contracts, acceptance criteria, constraints, and a budget. The worker starts from the assignment and reads anything else in its scope from the context base.
- **Coordinate.** A worker whose systems were split coordinates their owners. It assigns them work, integrates their reports, and checks that their contracts together keep its own. The lead coordinates the top level.
- **Report.** Every assignment ends with a report to the coordinator: the outcome, changes, evidence, captured knowledge, and follow-ups.
- **Escalate.** A worker escalates when it cannot meet its responsibility, needs another system's contract changed, needs a user decision, or finds its scope unclear. Escalations travel up the reporting line, and the lead turns user-level ones into decision requests.
- **Request a contract change.** A worker never edits another system's contract. It asks that system's owner through their nearest common coordinator, which approves, rejects, or escalates the request.
- **Activate.** A worker runs only when it has an assignment or a scheduled duty, such as the curator's review at the end of a task.

### Observing

The team view lists every member with its role, responsibility, scope, reporting line, status, current assignment, and last report, together with the history of team changes. The user can see it and can ask the lead for changes.

## Failure behavior

- A write outside a worker's scope is refused, and the response names the owner to ask.
- A worker that exceeds its budget or stops making progress is stopped. Its assignment is returned as failed, with its state recorded.
- A report whose evidence does not satisfy the acceptance criteria is not accepted as done. The coordinator reassigns the work, changes the scope, or escalates.
- A scope transfer that would leave a system with no owner or two owners is refused.
- When a worker's systems are removed from the design, the worker is retired and its coordinator is told.
- A team change that exceeds the workspace's limits on team size or depth is refused and reported to the lead.

## Guarantees and limits

- Each system has exactly one owner, so two workers never change the same part of the project.
- A worker changes only its own systems' design and the project files that belong to them. It never changes user context. It reports what user context needs to its coordinator, and the lead brings it to the user as a proposal or a decision request. It changes other systems only through their owners.
- A worker sees other systems only through their contracts.
- Every assignment ends in a report or an escalation, recorded in the context base.
- Prototype limits: only the lead creates and changes workers; one worker runs at a time; the user talks only to the lead.

## Acceptance examples

1. **Small project.** For a small command-line tool, the lead keeps every system and adds a reviewer. The team view shows two members.
2. **Forming during a conversation.** In this repository the user says the backend and frontend are getting large. The lead creates owners for the agent runtime with the database, for config, and for the frontend, plus a reviewer. The team view shows each one's responsibility and scope, and the lead now owns only the top level.
3. **Context split.** The frontend owner is assigned "add a spec panel." It can read all of user context, including the spec items for the panel. In agent context it can write the frontend's folder and read the runtime and config contracts and the knowledge entry "run frontend tests with `node --import tsx --test`." The runtime's design and plans are hidden from it.
4. **Contract change.** The frontend owner needs an endpoint the runtime lacks. It asks the runtime owner through the lead. The runtime owner changes its contract and implements it, and the frontend owner continues.
5. **Split.** The frontend grows. The lead splits it into the conversation UI and the workspace panels, with an owner for each. The frontend owner coordinates them, and their content moves with history intact.
6. **Escalation to the user.** The config owner finds that per-model temperature cannot be sent to one provider. It escalates, and the lead raises a decision request with options.
7. **Retire.** The two frontend parts are merged back. Their owners are retired, their systems return to the frontend owner, and the context base still holds everything they recorded.
