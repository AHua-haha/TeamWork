<!-- Task proposal; current contract is under docs/systems/ -->
# Workspace agent

## Purpose and boundary

The workspace agent builds and maintains a project for its user. The user's **design** describes the whole project and may consist of subdesigns. It is the shared contract between the user and agents, covering goals, required behavior, structure the user chooses, constraints, and acceptance examples. The lead helps the user develop and refine the design, and the user is aware of every change to it. Agents work freely within assigned scopes to realize the design and maintain the knowledge their work needs. Implementation details, work plans, and which agent did what remain visible but are never required reading.

Three principles shape every behavior below:

1. **Harness.** Each assignment defines the agent's work scope and authority, and the rules for maintaining context and knowledge within that scope. The agent acts freely inside this boundary while keeping the user's design true.
2. **Decompose.** Harness context is organized around the user's design and subdesigns. The team assigns agents to those scopes and may change its members, division of work, and responsibilities as the project develops.
3. **Consolidate and reuse.** What agents learn while working is kept and applied to later work.

The system acts only inside a workspace and within the permissions the user grants. Model providers and credentials come from the existing config system. One person uses a workspace.

### Terms

- **Workspace**: one project: its files, its context base, and its team.
- **Context base**: the workspace's persistent memory, kept as files in the workspace. Agent conversations are temporary; the context base is what lasts. It holds two categories of context:
  - **User context** is the user's information: the design, constraints, and preferences. The lead helps the user develop it. Every design change is visible to the user; the exact change and acceptance workflow is still being designed.
  - **Agent context**, also called **harness context**, is what agents maintain so that the user does not have to: realization details, work plans, progress, evidence, coordination records, and knowledge. Agents change it freely within their assigned authority while the user's design stays true. Its structure follows the design and subdesigns and survives replacement or retirement of an agent.
- **Design**: the user's design of the whole project and the shared contract that guides agents' work. It includes what the project should achieve and the decisions the user owns about its behavior and structure. The lead helps draft and refine it, and every change is made known to the user.
- **Subdesign**: a part of the whole design, for a system or piece of work the user designs. It has its own purpose, requirements, and relationships to other parts, and can itself contain subdesigns. It is shared with the user just as the whole design is.
- **Harness**: the rules governing an agent's assigned work. It has two parts: the scope and authority within which the agent may operate freely, and the duties and mechanisms for maintaining context and knowledge for that scope.
- **Assignment**: work given to an agent, with an objective derived from the design or a subdesign, responsibility, scope, authority, relevant harness context, and the result it must provide. Assignments and their knowledge outlast the agent that performs them.
- **Review boundary**: the line between user context and agent context. By default the user owns the goals, the whole project's behavior, and the constraints and preferences the user states. The user can take over any topic or system, moving it into user context, or hand one over to the agents.
- **Proposal**: a suggested change to the design presented by the lead for discussion with the user. The precise acceptance workflow is still being designed.
- **Lead**: the agent the user talks to. Each workspace has one lead, and every conversation in the workspace is with it.
- **Worker**: an agent the lead assigns work to, with a role, a responsibility, and a scope. A worker may be temporary or reused; its identity does not determine how durable context is organized.
- **Decision request**: a question only the user can answer, offered with options and a recommendation.

## Inputs and preconditions

- **Open a workspace.** The user creates a workspace for a new project or adopts an existing project directory. On adoption, the lead helps the user develop a design from the project.
- **Talk to the lead.** A message may change what the user wants, ask a question, request an operation (for example run, commit, or release), or correct how agents work. The user may start any number of conversations; each continues from the context base.
- **Decide.** The user accepts proposals (as drafted or with edits), rejects them, and answers decision requests. The user may also edit user-context files directly.
- **Configure.** The user moves the review boundary by taking over or handing over topics, and sets which actions need their approval.

## Outputs and observable effects

### Messages

- The lead treats each message as a design change, a question, an operation, or a working preference, and says which.
- **Design change.** The lead helps the user consolidate the request with the existing design and subdesigns. Every change is made known to the user, including changes suggested or inferred by the lead. How changes are presented and accepted is designed next; awareness alone does not prescribe a separate approval step for every edit.
- A request that contradicts the design is presented as a conflict between the old and new statements and is never applied silently. Once resolved, the replaced statement remains in history as superseded.
- **Question.** The lead answers from the context base and project files and cites its sources. A question changes nothing.
- **Operation.** The lead performs it if permitted and otherwise raises a decision request. The operation and its result are recorded.
- **Working preference.** The lead proposes it as a preference in user context. Once accepted, it applies to later work in this workspace, or in every workspace when the user says so.
- **Proactive help.** The lead also reviews user context on its own initiative. It points out ambiguity, gaps, and conflicts, and suggests improvements with their tradeoffs. Each one arrives as a proposal or a decision request.

### Work and progress

- The lead plans the work needed to realize the design, forms and changes the team, and assigns work. It may replace members, redistribute responsibilities and scopes, and revise the agent-controlled division of work. Work plans, team changes, and harness-context updates need no user approval. A change to the user's design or a subdesign is made known to the user.
- Each assignment draws its harness context from the relevant design and subdesigns. Ending an assignment or retiring its agent keeps that context available to the next assignment and agent.
- Each design requirement shows its status: planned, in progress, delivered, or verified. A verified requirement cites the checks that verified its acceptance examples.
- When work needs a user decision, a decision request appears with options and a recommendation. Only the work that depends on it waits.
- The user can read harness context (realization details, team, work, evidence, and knowledge) but never needs to, and cannot edit it through the application. To influence it, the user tells the lead, which helps record the relevant design change, constraint, or preference.

### Scoped freedom

Agents decide freely within their harness while keeping the user's design true: realization details, division of agent work, team, task order, code, tests, and tools within permissions. Agents involve the user, in the user's terms, when:

- a choice requires a change to the design or a subdesign;
- a request is ambiguous or conflicts with the design;
- the design cannot be realized as stated;
- an action is irreversible or reaches outside the workspace and the user has not granted it.

### Knowledge

The context-maintenance part of the harness requires an agent to keep the context for its scope useful to later work: record decisions and their reasons, current progress, evidence, open questions, and reusable knowledge; reconcile these with what is already recorded; and identify what is superseded. The detailed maintenance rules and mechanisms are designed next.

Agents record what they learn while working, such as procedures, pitfalls, environment facts, and working patterns, and apply it to later work. This knowledge is harness context organized around the design and subdesigns, with cross-cutting knowledge linked to the parts it concerns. The user does not need to follow or approve these updates. When the design is split, merged, or reorganized with the user, its relevant harness context remains connected and available, preserving the project's knowledge. Preferences the user states belong in user context. What agents notice about the user stays agent knowledge until the user confirms it.

## Failure behavior

- A model or provider failure pauses the affected work and reports it. The context base keeps the last recorded state, and a retry continues from there.
- A worker that cannot meet its responsibility escalates. The lead reassigns the work, changes approach, or raises a decision request. A failure appears in progress and is never reported as delivered.
- A failed verification keeps the design requirement from being reported as verified.
- A rejected proposal leaves the design unchanged, and no work starts from it.
- A conversation that ends or is cleared mid-work loses nothing; the work continues and can be followed from another conversation.
- If the user's direct edit to user context conflicts with work in progress, the edit stands. The affected work is re-planned and the conflict is reported.

## Guarantees and limits

- Every change to the design or a subdesign is made known to the user. Agents never silently weaken the design to make work pass.
- The user can understand and evaluate the project from user context and reports alone.
- Everything later work depends on is recorded in the context base, in the workspace, where the user can read it. No agent conversation is the only copy of anything.
- Harness context follows the user's design and subdesigns, independently of the team roster. Changing an agent, its responsibility, or its scope does not lose that context. Changes to the design structure preserve the relevant accumulated knowledge.
- Each agent sees only the context its responsibility needs. Nothing is hidden from the user.
- Agents act only inside the workspace and within granted permissions.
- Prototype limits: one user; local project directories; the user talks only to the lead; software projects whose acceptance examples can be checked by commands; one worker runs at a time.

## Acceptance examples

1. **New project.** The user says, "I want a command-line reading list; each book has a title, an author, and a status." The lead helps the user develop a design with behaviors and acceptance examples. The team realizes it, and progress shows each requirement verified with the checks that verified it. The user never needs to review code.
2. **Conflicting request.** The design gives each model its own reasoning levels, and the user asks for one shared scale. The lead shows both statements; the user confirms; the old statement is superseded and work follows the new one.
3. **Question.** "How is a reasoning level sent when the model lacks it?" The lead answers from the design and cites it. Nothing changes.
4. **Preference.** "Don't run the MySQL tests in the sandbox; I'll run them." The lead proposes it as a preference, and the user accepts. From then on, work that needs those tests asks the user to run them.
5. **New conversation.** The next day the user opens a new conversation and asks, "What's pending?" Without the earlier conversation, the lead lists unverified design requirements, work in progress, and open decision requests.
6. **Decision request.** Exporting to PDF needs a paid library. A decision request offers the paid library, a free one with fewer features, or dropping the item, and recommends one. Other work continues.
7. **Scoped context.** The worker responsible for the frontend sees the runtime subdesign and the harness context its assignment needs.
8. **Reuse.** A fix found in one task ("run the tests with `node --import tsx --test` in the sandbox") is applied in the next task without being rediscovered.
9. **Replace a worker.** Backend records its realization details, progress, evidence, and open questions in harness context associated with the backend subdesign. The lead retires Backend and assigns that work to a new member with the same scope. The new member continues from those records without needing Backend's conversation.
10. **Reorganize the design.** The lead helps the user split a storage subdesign into project files and context history. The user sees the design change, and harness context follows the resulting subdesigns with references to shared knowledge. Later agents can continue using the accumulated decisions and evidence.
