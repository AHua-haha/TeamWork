<!-- Task proposal; current contract is under docs/systems/ -->
# Team implementation

## Contract

[Team design](design.md). The guarantees most exposed to change: one lead per team and unique member names; members exist only inside their team; a workspace never exists without a lead; a call returns only the recipient's final response and calls cannot loop; a member writes agent context only inside its scope and never writes user context.

## Responsibilities and decomposition

The team is realized by one set of cooperating modules. It has no child system with a contract of its own; the [workspace](../workspace/design.md), [context base](../context-base/design.md), [config](../../config/design.md), and [agent runtime](../../agent-runtime/design.md) are its neighbors.

- `TeamService` owns member records: validation, the lead's initial record, creation, change and retirement, and readiness, which it asks the config service to judge from a member's run settings.
- `WorkspaceService` creates the lead together with the workspace, using the initial record `TeamService` defines, and `TeamService.initialize` gives workspaces registered before teams a lead when the backend starts.
- `TeamRunner` owns the run part: the chain of each active run, which members are running, a call from one member to another, and retirement of an active member. It keeps no queue.
- `MemberFiles` and `memberAccess` own what a member may do in the workspace folder: its access rule, and the operations Pi's file tools call.
- `MemberContext` builds a member's instructions for each model call from the team and the context base.
- The member tools module owns the tools: Pi's file tools adapted to the runtime, `send_message`, and the lead's management tools.
- `TeamSystem` wires these together and wraps the runtime policy so team members, and only they, get the tools and instructions. The team routes serve the HTTP operations.

## Coordination and data flow

**A member's record.** A member is a row in `members` and a conversation in `agents` with the same ID, created in one transaction. The record holds name, role, responsibility, scope, run settings, the lead flag, and the retired time. The store keeps the lead flag and the lower-cased active name in columns with unique keys, so a second lead, or two active members with one name, fails even across processes. Retiring sets the retired time and clears the name key.

**The lead.** `WorkspaceService.create` passes the store the workspace and its lead, and the store registers both in one transaction. If either fails, neither is stored, and the service removes a folder it created. Reading a team only reads; a workspace with no lead is reported as corrupt data. At startup, `TeamService.initialize` walks the registered workspaces and creates the lead of any that has none. It is idempotent, and the unique lead key stops two backends racing to create two.

**Resolving a run.** `teamRunConfig` is the runtime's config source. For a member it asks `ConfigService.resolveSettings` with the member's settings and revision, which applies the rules agents use. For any other agent it asks `resolveForRun`. The run snapshot is then the same kind of object for both.

**Each model call.** The wrapped policy first builds the standard request. For a member it then:
1. puts the file tools and `send_message` in front of the catalog tools, and adds the management tools for the lead;
2. replaces the system prompt with the member's instructions.

`MemberContext.instructions` reads the team and the context base now, so the roster, the scope, and the files are current for every call even in a long run. User context files come first, then the files of the member's scope, each section cut at 64 KiB with the paths of files left out listed. The lead also gets the list of all agent context files. The member's standing instructions from its settings and prompt options end the text.

**User input.** `POST /agents/:id/runs` goes to `TeamRunner.startUser`. A conversation that is not a member goes to the runtime as before. A member that is not the lead is refused with `member_conversation`. The lead starts a run with the chain `[lead]`, or fails with the runtime's `agent_busy`.

**Running state.** The runner keeps the set of members that have a run in progress, in memory. A member is added when its run starts, and removed when the runtime reports the run finished. The runtime stops every run when the backend stops, so the set cannot outlive the process. The team system adds each member's `running` flag to the team views.

**A call.** `call(caller, run, signal, name, text)`:
1. checks the text, finds the active recipient by name, and refuses the caller itself;
2. takes the caller's chain from its run, or `[caller]` when the run has not recorded one, and refuses a recipient already in it or a chain that is full;
3. asks the config service whether the recipient can run, and refuses with the issues if not;
4. starts a run of the recipient with the text prefixed by the caller's name, and records the chain `[...chain, recipient]` for that run; a recipient that is already running is refused as busy;
5. wires the caller's abort signal to cancel the recipient's run, so a Stop of the caller reaches the whole chain, since each recipient's own call is wired the same way;
6. waits for the runtime to report the run finished, then reads the final assistant text of that run from storage;
7. returns the text, cut at 20,000 characters, or a sentence telling how the run ended when it did not complete.

The result is always a normal tool result. The runtime ends a run when a tool reports failure, and a recipient's failure is something its caller can act on.

**Retiring.** The service marks the member retired. The runner then cancels the member's active run through the runtime, which ends any call waiting for it. What the member wrote stays in the folder.

**File tools.** Pi's `read`, `write`, `edit`, and `ls` tools take a working directory and pluggable operations. The tool definitions are built once. At each call the adapter looks up the calling member, builds the Pi tool with `MemberFiles` operations for that member, and runs it. Every operation resolves its absolute path to workspace segments, refuses a path outside the folder, hides `.git`, applies the member's access rule, refuses a link at any step, and, for writes, applies the context base's name rules under `.context/` and the text rules and size limit. Writes go to a temporary file in the target's folder and are renamed over it, keeping permissions.

The runtime ends a run when a tool reports failure. The adapter therefore returns a failure of a file tool, such as a missing file, a refusal, or text that does not match, as the tool's result. Cancellation still ends the run. The team tools do the same for refusals, and let a storage failure end the run.

## Decisions and constraints

- **Members are not agents with a config.** A member's settings live in its record, validated and resolved by the config service's shared code. Keeping them out of the `agent` config scope keeps members out of the agent list and the config API, and gives the team one place to change them. The `agent` scope refuses to create a config for a member's ID.
- **Pi's tools, not our own.** The agent's file tools are `@earendil-works/pi-coding-agent`, pinned at the version of `pi-ai`. Its `grep` and `find` read the disk themselves (`ripgrep` and `fd`, downloaded on first use), so an access rule cannot limit them; `bash` cannot either. They are left out until there is a search the access rule can scope. Pi's file tools take pluggable operations, which is where the scope is enforced.
- **Scope is enforced in the operations.** The file tools are the only way a member writes, so enforcing the scope there makes it hold whatever the model asks for. The context base does not know about scopes.
- **A call is a blocking tool call.** The caller waits, so no queue, delivery rule, or notice to senders is needed, there is no depth bookkeeping beyond the chain, and the caller's tool result is the report. The cost is that the lead is busy during a call and members work one after another. Members stay persistent, with their own conversations, so a later cooperation rule can replace the call without touching them.
- **Only the final text returns.** The caller gets the last assistant text of the recipient's run, so its context grows by a report, not by the recipient's work. The recipient's instructions tell it to end with a report and to put details in files.
- **The lead cannot be called.** Every chain starts at the lead, so a worker that needs the lead's decision ends its run with the question. A call back would deadlock the lead, which waits.
- **The lead exists with its workspace.** Creating the lead in the same transaction as the workspace removes a write from reads and the race between two first reads that creating it lazily needed.
- **Order is explicit.** Members are listed in the order the store numbered them, not by time, because two members can be created in one millisecond.
- **Instructions are rebuilt for each call.** This costs reads from the context base on every call, and gives the roster and scope no staleness. A cache or a cache-friendly layout is a later runtime concern.
- **The lead may change everything but itself.** The tools refuse the lead as a target. The user can change the lead through HTTP, so the user is never locked out.

## Code map

- [Team service, records, and run config source](../../../../../../backend/src/team.ts)
- [Team runner](../../../../../../backend/src/team-runner.ts)
- [Member files and access rule](../../../../../../backend/src/member-files.ts)
- [Member context](../../../../../../backend/src/member-context.ts)
- [Member tools](../../../../../../backend/src/member-tools.ts)
- [Team system and policy](../../../../../../backend/src/team-system.ts) and [team routes](../../../../../../backend/src/team-routes.ts)
- [MySQL member storage](../../../../../../backend/src/database.ts)
- Tests: [team](../../../../../../backend/test/team.test.ts), [member files](../../../../../../backend/test/member-files.test.ts), [member context and policy](../../../../../../backend/test/team-context.test.ts), [routes](../../../../../../backend/test/team-routes.test.ts), and the [fixture](../../../../../../backend/test/team-fixture.ts).

## Verification

The tests run against a temporary workspace folder, the in-memory store, and a fake runtime whose runs end when the test says so. They cover:
- the lead created with the workspace and by the startup step, a read that changes nothing, unique names, the size limit, revisions, and retirement;
- calls: the final response returned and cut, the recipient's prefix, a chain that refuses a member twice, the lead, and a sixth member, a busy or unready recipient, failed and cancelled recipients, a Stop reaching down the chain, and `running` while a call works;
- refusals of user input to members;
- retirement cancelling a run that a call waits for;
- the lead's tools, and a worker being refused them;
- Pi's tools over a member's view: scope, user context, hidden `.git`, links, paths outside the folder, name and size rules, and a mismatched edit;
- the instructions: roster, user context, only the member's own scope, the section budget, and that they name only tools the member has;
- the HTTP routes and the refusal of user input to a worker.

The MySQL integration tests cover the member store: the lead and name keys, revisions, retirement freeing a name, members kept out of the agent list, and no config for a member. This task's runs are recorded in the [task verification log](../../../tests.jsonl).
