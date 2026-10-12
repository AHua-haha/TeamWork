# Team

## Purpose and boundary

A workspace's team is the group of agents that work on its project. The team belongs to its workspace: its members exist only there, are created and configured only through the team, and are not agents in the global agent list. An agent outside any workspace is a different kind of thing; the [config design](../../config/design.md) covers it. Creating or adopting a workspace creates its team with its lead, in the same step, so a workspace never exists without a lead. The lead is the member whom the user talks to.

The team has two parts:

- **Management** creates, configures, and retires members. The lead does it while it talks with the user, by forming the team that the project needs. The user can see every member, and the application offers the user no way to create members.
- **Run** gives members work: a member asks another member as it would call a tool, and the recipient's final response comes back as the result.

The team does not run model loops, store content, or decide what the user wants. Those belong to the [agent runtime](../../agent-runtime/design.md), the [context base](../context-base/design.md) and [workspace](../workspace/design.md), and the user.

This version is a skeleton. It fixes the interfaces and the simplest rule behind each one. Role-specific rules, cooperation rules, budgets, and richer scopes come later and are expected to replace rules here without changing the interfaces.

### Terms

- **Member**: a named agent of the team with a role, a responsibility, a scope, run settings, and a conversation of its own. The conversation continues across calls. Members of one team do not share conversations.
- **Lead**: the member created with the team. It is the only member the user sends messages to and the only member that changes the team. It cannot be retired.
- **Role**: a free-text label, such as "backend developer". Several members may share a role. A role carries no behavior of its own.
- **Responsibility**: the text that says what the member is accountable for.
- **Scope**: a list of agent-context paths, each a file or a folder. It is what the member sees and may change of the team's agent context.
- **Run settings**: provider connection, model, tools, prompts, instructions, and per-model options. They have the same fields and rules as an agent's settings in the config design.
- **Call**: one member asking another with `send_message`. The recipient runs, and the caller waits. The recipient's last assistant text is the **final response**, and it alone is returned to the caller.
- **Chain**: the members involved in one run started by the user, in the order they were called, beginning with the lead.

## Inputs and preconditions

### Management

| Operation | Request | Response |
| --- | --- | --- |
| View the team | `GET /workspaces/:workspaceId/team` | 200, `{workspaceId, members}`: the lead first, then the others by creation. Reading changes nothing |
| Create a member | `POST /workspaces/:workspaceId/team/members`, JSON `{name, role, responsibility?, scope?, settings?}` | 201, the member |
| Read a member | `GET /workspaces/:workspaceId/team/members/:memberId` | 200, the member |
| Change a member | `PUT /workspaces/:workspaceId/team/members/:memberId`, JSON `{revision, value}` | 200, the member |
| Retire a member | `DELETE /workspaces/:workspaceId/team/members/:memberId`, JSON `{revision}` | 200, `{retired: memberId}` |

A member is `{memberId, workspaceId, revision, name, role, responsibility, scope, lead, settings, issues, ready, running}`. `memberId` is also the ID of the member's conversation in the [runtime](../../agent-runtime/design.md). `issues` lists what stops the member from running, using the config system's wording, and `ready` is true when there are none. `running` is true while the member has a run in progress, whether the user or another member started it. A new lead has the issue **Select a provider and model**.

- **Fields.** `name` is 1–40 characters: letters, digits, spaces, `.`, `_`, `-`, starting and ending with a letter or digit. It is unique in the team, ignoring letter case, among members that are not retired. `role` is 1–80 characters without control characters. `responsibility` is at most 4,000 characters and may be empty. `scope` has at most 50 distinct paths in the context base's form, such as `agent/systems/backend/` written as `agent/systems/backend`; each starts with `agent` and may be `agent` alone. A team has at most 20 members that are not retired.
- **Settings on create.** `settings` may give any of the run-settings fields. Fields left out copy the lead's current values, except `prompt`, which starts empty. The lead's own settings start empty.
- **Change.** `value` gives every editable field: `name`, `role`, `responsibility`, `scope`, `settings`. `revision` is the value last read. A member's `lead` flag never changes.
- **Retire.** A retired member leaves the team view and its name becomes free. Its conversation stays readable.
- **The lead.** Creating or adopting a workspace creates the lead together with the workspace, named **Lead**, with role **Lead** and no model. If creating the lead fails, the workspace is not created. When the backend starts, it gives a workspace that has no lead one, so workspaces registered before teams existed get theirs.
- **Who may do what.** The lead may create, change, and retire other members through its tools. It cannot change or retire itself, so a wrong change can never lock the user out of their only conversation partner. Other members cannot change the team. The HTTP operations above can change any member, including the lead; the application uses them to show members, and to let the user choose the lead's model.

### Run

- **User to lead.** The user sends input to the lead's conversation exactly as for any conversation: `POST /agents/:memberId/runs` with `{input}`, answered with 202 and the run, as the [runtime](../../agent-runtime/design.md) defines. Input to any other member's conversation is refused: the user talks to the lead, and the lead gets work done through the others.
- **Call.** A member calls another with its `send_message` tool, naming the recipient and giving the text (1–20,000 characters). The recipient receives the text as a user message that begins with the caller's name, and runs. The caller's tool call waits until that run ends and then returns the recipient's final response. Nothing else of the recipient's run reaches the caller: not its reasoning, its tool calls, or its files.
- **Observing.** The lead's conversation can be followed, read, and cancelled through the runtime's state, follow, and cancel operations. Another member's conversation can be too, but the application does not show it.

### What a member works with

Every member has these tools, whatever its role:

| Tool | Does |
| --- | --- |
| `send_message` | Asks another member and returns its final response |
| `ls`, `read`, `write`, `edit` | Pi's coding-agent file tools, working through the [workspace's file actions](../workspace/design.md) on the project folder, including `.context/` |

The lead has these as well:

| Tool | Does |
| --- | --- |
| `create_member` | Creates a member from a name, role, responsibility, and optionally a scope, instructions, and a model |
| `update_member` | Changes any of those on a member, named by name |
| `retire_member` | Retires a member, named by name |
| `list_models` | Lists the provider connections and their models, for choosing a member's model |

Tools the config catalog selects for a member's settings are added to these.

Access rules for the file tools apply to every member:

- `.git/` is hidden.
- **User context** (`.context/user/`) is readable and never writable. It changes only through the user.
- **Agent context** (`.context/agent/`) is readable and writable inside the member's scope, and invisible outside it. The lead's access covers all agent context; its scope only chooses what is loaded into its instructions.
- All other project files are readable and writable. Permissions for project files are designed later.
- A refused or failed file action returns its reason to the member as the tool's result, so the member can act on it and its run goes on.
- There is no content search yet; a member finds things by listing and reading.

Each model call of a member starts with instructions assembled just before the call: the team's working rules for the member's kind, its name, role, responsibility, and scope, the team roster with every member's role, responsibility, and readiness, and the member's own instructions from its settings. They are followed by a view of the context base: all user context files, then the files of its scope. The lead also gets a list of all agent context files. A section is cut at 64 KiB; files that did not fit are listed by path so the member can read them with its tools.

## Outputs and observable effects

### Forming the team

- A new workspace's team has the lead, named **Lead**, with role **Lead** and no model selected. The user selects its model by changing the lead; until then the lead cannot run.
- Creating, changing, and retiring members take effect for the next run of the affected member and the next model call of every member's instructions (the roster). A run that has started keeps its model, settings, and tools; its scope and roster are read again for each call.
- Retiring a member cancels its active run. A caller waiting for that run is told that the member was cancelled.
- The team's design, such as who owns which system, is whatever the lead writes into agent context. The team records nothing about it.

### Running

- **A call is a run.** The recipient starts a run with the call's text as input and works with its own tools and files, in its own continuing conversation. The call returns when that run ends. A caller's calls happen one at a time: while a member waits, it does nothing else, and the model calls of its own run resume when the response arrives.
- **User input.** The user's input to the lead starts a run immediately, or fails with 409 `agent_busy` when the lead is already running; it is never queued. While the lead waits for a call, it is running, so the user cannot send it input; the user can stop the run.
- **Final response.** The result of a call is the recipient's last assistant text of that run, up to 20,000 characters; a longer response is cut, with a note saying so. A recipient that ends without text returns a note saying so. Because the caller sees nothing else, the instructions tell every member to end with a response that says what was done, which files changed, and what is still open, and to write details into files.
- **Who may be called.** Any active member that is not in the current chain. Every chain starts at the lead, so no member can call the lead, and no two members can call each other in a loop. A member that needs the lead's decision ends its run with the question as its final response. A worker may call another worker. A chain has at most five members, the lead included.
- **Stopping.** Stopping the lead's run cancels the run of the member it waits for, and so on down the chain. Nothing is left running.
- **One chain at a time.** Only the user starts a chain, and only the lead takes the user's input, so each team has at most one chain at a time and one member working at a time.

## Failure behavior

| Status | Codes | When |
| --- | --- | --- |
| 400 | `invalid_input`, `invalid_config`, `invalid_path` | A malformed request, or a name, role, responsibility, scope, or settings that break the rules |
| 404 | `not_found` | An unknown workspace or member |
| 409 | `member_exists`, `config_conflict`, `lead_required`, `team_full`, `member_conversation`, `agent_busy` | A name already used; a stale revision; retiring the lead; more than 20 members; input from the user to a member that is not the lead; the lead already running |
| 503 | `workspace_unavailable`, `backend_error` | The workspace folder or storage is unavailable |

- A refused change leaves the team unchanged.
- A lead's tool call that breaks a rule is refused with the reason as the tool's result; the run goes on.
- A call that cannot happen is refused, with the reason as the tool's result and the caller's run going on: an unknown name (the answer lists the team), the caller itself, a member already in the chain, a chain that is too long, a member that is already running, a member whose settings have issues (the answer gives them), or empty or oversized text. Input from the user to a lead with issues fails as it does for any conversation, with 409 `invalid_agent_config`.
- A recipient whose run fails, is cancelled, or is interrupted still ends the call: the result tells the caller which happened and gives the failure's reason, and the caller's run goes on. The team does not retry or resume the recipient. Whatever it wrote before stays.
- Stopping a run, or retiring a member, cancels the active run of the member being waited for. A file already written stays.
- When the backend stops, active runs are interrupted as the runtime defines. A call does not resume; the lead starts again from the context base.

## Guarantees and limits

- Members exist only inside their team. No member appears in `GET /agents`, and no member has an agent config.
- Every team has exactly one lead, the lead is never retired, and member names are unique within a team.
- No member other than the user changes user context.
- A member changes agent context only inside its scope, except the lead, which may change all of it.
- Calls form one chain of at most five members, with no member twice, so calls end and cannot loop.
- Only the final response of a call reaches the caller.
- Members' file writes are recorded by the context base as outside changes. The context base's history therefore shows them as authored by `external`, not by the member.
- Prototype limits:
  - The user talks only to the lead.
  - While the lead waits for a call, the user cannot send it input. Members work one after another, never in parallel, and a member cannot reach the lead while it works.
  - A workspace has one lead and so one lead conversation, which only grows; there is no compaction yet.
  - Roles carry no behavior, there are no budgets beyond the runtime's step limit, and no member can run commands or use version control.
  - A member cannot be reassigned to another workspace, and a retired member cannot return.
  - A member sees the whole of each file in its view, up to 64 KiB per section, and has no ranking or summarizing of context.

## Acceptance examples

1. **New team.** The user creates a workspace and views its team. It has one member, **Lead**, role **Lead**, `ready` false with the issue **Select a provider and model**, and `running` false. Viewing the team again changes nothing. The lead's conversation is not in `GET /agents`. A workspace registered before teams existed has its lead after the backend starts.
2. **Configure the lead.** The user changes the lead's settings to a model. The member reads `ready` true. The user sends "Build a reading-list tool" to the lead and a run starts.
3. **Forming.** During that run the lead calls `create_member` with name `Backend`, role `backend developer`, responsibility "Implement and test the command-line tool", and scope `agent/systems/backend`. The team view lists Backend with the lead's model. The lead's next model call lists Backend in its roster.
4. **Assigning and reporting.** The lead writes `.context/agent/systems/backend/plan.md` and calls Backend: "Implement step 1 of the plan." The team view shows Backend `running`. Backend reads the plan from its scope, edits `src/cli.ts`, writes `.context/agent/systems/backend/report.md`, and ends with "Step 1 is done; see the report." That text is the result of the lead's call, and the lead's run continues. The lead's conversation shows the call with its input and that result, and none of Backend's steps. The context base shows the plan and the report as `external` versions.
5. **Scope.** Backend tries to read `.context/agent/systems/frontend/plan.md`. The action is refused, naming its scope. Backend writing `.context/user/spec.md` is refused, as is the lead.
6. **In turn.** The lead's reply contains two calls, to Backend and to Frontend. Backend runs and returns; then Frontend runs. While they work, the user's input to the lead is refused with 409 `agent_busy`, and Stop ends the lead's run and the run being waited for.
7. **Chains.** Backend, while working, calls `Lead` and is told that Lead is already in the chain, so it ends with its question as its final response. Backend calls Frontend, which calls Backend, and Frontend is told the same. A chain of five members refuses a sixth call.
8. **Refusals.** Input from the user to `Backend`'s conversation returns 409 `member_conversation`. Retiring the lead returns 409 `lead_required`. Creating a second `backend` (any case) returns 409 `member_exists`.
9. **Retire.** While Frontend works for a call from Backend, the user retires Frontend through the HTTP operation. Its run is cancelled, Backend's call returns "Frontend was cancelled", and Frontend leaves the team view. Its conversation can still be read, and a new `Frontend` can be created.
10. **Failure.** Backend's run fails with a model error. The lead's call returns "Backend failed: …", and the lead decides whether to try again or change the plan.
