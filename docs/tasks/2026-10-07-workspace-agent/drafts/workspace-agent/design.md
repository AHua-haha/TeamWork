<!-- Task proposal; current contract is under docs/systems/ -->
# Workspace agent

## Purpose and boundary

The workspace agent builds and maintains a project for its user. The user says what they want; the system keeps it as the project's spec and does the work to satisfy it. The user works only with the spec, the decisions it needs, and the evidence that it is met. Plans, code, internal design, and which agent did what remain visible but are never required reading.

Three principles shape every behavior below:

1. **Harness.** Conversation becomes spec. Agents act freely within the spec and ask the user only for decisions that are the user's to make.
2. **Decompose.** The project is divided into systems. Each agent owns a part and works with only the context that part needs.
3. **Consolidate and reuse.** What agents learn while working is kept and applied to later work.

The system acts only inside a workspace and within the permissions the user grants. Model providers and credentials come from the existing config system. One person uses a workspace.

### Terms

- **Workspace**: one project: its files, its context base, and its team.
- **Context base**: the workspace's persistent memory, kept as files in the workspace. Agent conversations are temporary; the context base is what lasts. It holds two categories of context:
  - **User context** is the user's information: what the user knows and decides, such as goals, spec, constraints, and preferences. Agents help draft, suggest, refine, and improve it, but it changes only through the user's edits and accepted proposals.
  - **Agent context** is what agents know so that the user does not have to, such as design below the review boundary, work, evidence, team, and knowledge. Agents change it freely while user context stays true.
- **Spec**: the part of user context that describes how the project must behave at the systems the user reviews: purpose, behaviors, failures, guarantees, acceptance examples, and terms. "Spec" alone often stands for all user context.
- **Design**: how the project is built to keep the spec: its division into systems, each system's contract, and how each is realized. It is agent context, except for choices the user made, which are constraints in user context.
- **Review boundary**: the line between user context and agent context. By default the user owns the goals, the whole project's behavior, and the constraints and preferences the user states. The user can take over any topic or system, moving it into user context, or hand one over to the agents.
- **Proposal**: a change to user context drafted by the lead. It is recorded when the user accepts it, possibly with edits.
- **Lead**: the agent the user talks to. Each workspace has one lead, and every conversation in the workspace is with it.
- **Worker**: an agent the lead adds to the team, with a role, a responsibility, and a scope.
- **Decision request**: a question only the user can answer, offered with options and a recommendation.

## Inputs and preconditions

- **Open a workspace.** The user creates a workspace for a new project or adopts an existing project directory. On adoption, the lead drafts a spec and design from the project for the user to accept.
- **Talk to the lead.** A message may change what the user wants, ask a question, request an operation (for example run, commit, or release), or correct how agents work. The user may start any number of conversations; each continues from the context base.
- **Decide.** The user accepts proposals (as drafted or with edits), rejects them, and answers decision requests. The user may also edit user-context files directly.
- **Configure.** The user moves the review boundary by taking over or handing over topics, and sets which actions need their approval.

## Outputs and observable effects

### Messages

- The lead treats each message as a spec change (to goals, spec, or constraints), a question, an operation, or a working preference, and says which.
- **Spec change.** The lead consolidates it with existing user context and proposes the result as a change to that context, never as code. Every change is a proposal, whether the user stated it directly or the lead added, inferred, suggested, or refined it. It is recorded only when the user accepts it. Work toward a change starts only once it is in user context.
- A request that contradicts the accepted spec is presented as a conflict between the old and new statements and is never applied silently. Once resolved, the replaced statement remains in history as superseded.
- **Question.** The lead answers from the context base and project files and cites its sources. A question changes nothing.
- **Operation.** The lead performs it if permitted and otherwise raises a decision request. The operation and its result are recorded.
- **Working preference.** The lead proposes it as a preference in user context. Once accepted, it applies to later work in this workspace, or in every workspace when the user says so.
- **Proactive help.** The lead also reviews user context on its own initiative. It points out ambiguity, gaps, and conflicts, and suggests improvements with their tradeoffs. Each one arrives as a proposal or a decision request.

### Work and progress

- The lead plans the work needed to meet the accepted spec, forms and changes the team, and assigns work. Plans, team changes, and design below the review boundary need no user approval.
- Each spec item shows its status: planned, in progress, delivered, or verified. A verified item cites the checks that verified its acceptance examples.
- When work needs a user decision, a decision request appears with options and a recommendation. Only the work that depends on it waits.
- The user can read agent context (team, work, design, evidence, and knowledge) but never needs to, and cannot edit it through the application. To influence it, the user tells the lead, which proposes a constraint or preference for user context that agents then follow.

### Scoped freedom

Agents decide without asking anything that keeps user context true: the design in agent context, decomposition, team, task order, code, tests, and tools within permissions. Agents ask the user, in the user's terms, when:

- a choice changes behavior the user can observe and the spec does not settle it;
- a request is ambiguous or conflicts with the spec;
- the spec cannot be met as stated;
- an action is irreversible or reaches outside the workspace and the user has not granted it.

### Knowledge

Agents record what they learn while working, such as procedures, pitfalls, environment facts, and working patterns, and apply it to later work. This knowledge is agent context, and the user does not need to manage it. Preferences the user states belong in user context. What agents notice about the user stays agent knowledge until the user confirms it.

## Failure behavior

- A model or provider failure pauses the affected work and reports it. The context base keeps the last recorded state, and a retry continues from there.
- A worker that cannot meet its responsibility escalates. The lead reassigns the work, changes approach, or raises a decision request. A failure appears in progress and is never reported as delivered.
- A failed verification keeps the spec item from being reported as verified.
- A rejected proposal leaves the spec unchanged, and no work starts from it.
- A conversation that ends or is cleared mid-work loses nothing; the work continues and can be followed from another conversation.
- If the user's direct edit to user context conflicts with work in progress, the edit stands. The affected work is re-planned and the conflict is reported.

## Guarantees and limits

- User context changes only through the user's edits and the proposals the user accepts. Agents never weaken it to make work pass.
- The user can understand and evaluate the project from user context and reports alone.
- Everything later work depends on is recorded in the context base, in the workspace, where the user can read it. No agent conversation is the only copy of anything.
- Each agent sees only the context its responsibility needs. Nothing is hidden from the user.
- Agents act only inside the workspace and within granted permissions.
- Prototype limits: one user; local project directories; the user talks only to the lead; software projects whose acceptance examples can be checked by commands; one worker runs at a time.

## Acceptance examples

1. **New project.** The user says, "I want a command-line reading list; each book has a title, an author, and a status." The lead proposes a spec with behaviors and acceptance examples. After acceptance the team builds it, and progress shows each spec item verified with the checks that verified it. The user never reviews code.
2. **Conflicting request.** The spec gives each model its own reasoning levels, and the user asks for one shared scale. The lead shows both statements; the user confirms; the old statement is superseded and work follows the new one.
3. **Question.** "How is a reasoning level sent when the model lacks it?" The lead answers from the spec and cites it. Nothing changes.
4. **Preference.** "Don't run the MySQL tests in the sandbox; I'll run them." The lead proposes it as a preference, and the user accepts. From then on, work that needs those tests asks the user to run them.
5. **New conversation.** The next day the user opens a new conversation and asks, "What's pending?" Without the earlier conversation, the lead lists unverified spec items, work in progress, and open decision requests.
6. **Decision request.** Exporting to PDF needs a paid library. A decision request offers the paid library, a free one with fewer features, or dropping the item, and recommends one. Other work continues.
7. **Scoped context.** The worker responsible for the frontend sees the runtime's contract but not how the runtime is implemented.
8. **Reuse.** A fix found in one task ("run the tests with `node --import tsx --test` in the sandbox") is applied in the next task without being rediscovered.
