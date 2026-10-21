# Harness

## Purpose, responsibilities and boundaries

A harness defines, for one purpose, which tools an agent receives, what those tools may touch, and which maintenance rules it follows. The runtime assembles the selected harness into the member's environment and runs the model loop; the harness itself executes nothing except through the tools it grants.

Three fixed bases serve this project: **management** (design and member maintenance, lead only), **implementation** (working-node implementation context and accepted mapped source), and **execute** (persistent Bash and web tools, granted to every active member). A member's purpose base is derived from its role; its working/dependency design assignments derive file authority from the accepted design mappings and cannot be configured independently. Every member works directly on the registered shared workspace.

The harness owns permission decisions for tool invocations and for explicit Git commits. It does not own Git itself: ordinary project Git history, staging, inspection and restore are the agent's own Bash work, and the harness supplies no scopes, private repositories, separate indexes or automatic checkpoints. It also does not own the model loop, context storage or a security sandbox beyond the tool-input checks described here.

## Interface contract

**Purpose and supported interactions.** A caller (the runtime/team) asks for a member's effective harness: which tools are available, what their inputs are authorized against, which prompts are assembled into the system prompt, and which commit decisions the Bash tool must make. Members then use ordinary tool calls — `read`, `ls`, `grep`, `find`, `write`, `edit`, `bash`, `web_search`, `web_fetch`, `list_models`, `validate_member_config` — and the harness authorizes each invocation before execution.

**Required inputs and returned information.** Inputs are the member's role, its `designScope` with working and dependency design-node references, its supplementary prompt files, and, at tool invocation time, the requested tool name and its exact input. The harness returns the member's tool set with prompt text and maintenance rules, the resolved write authority (design context, implementation context, implementation paths, split into working scope and read-only dependencies), and for a write/edit or commit request either permission or a named refusal. Management reads return design-node lookups, workspace model choices and member-validation findings.

**Observable effects.** An authorized `write`/`edit` changes a file in the shared workspace; an authorized `bash` call runs in the member's persistent shell with broad resource access; an authorized commit creates an ordinary project commit. An approval-required commit pauses the Bash call and exposes a pending request to the user, whose decision returns to the waiting tool. Refused invocations change nothing.

**Failure behavior and lifecycle.** A refusal is returned to the agent as a recoverable tool error carrying the reason; the agent may adapt, use Bash where its assignment permits, or report the limitation. File-input authorization is not OS isolation: Bash keeps broader authority by design. Shells and jobs survive runs and stop on context reset, retirement, affected activation, or shutdown. A pending approval is bound to its run; cancellation, shell reset or backend restart removes it without replay.

## Constraints, specifications and requirements

- Built-in tools keep Pi's default operations, schemas, results, details and truncation. No permission-enforcing replacement of the underlying filesystem operations is used; authorization happens before invoking the unchanged built-in.
- Read-only tools (`read`, `ls`, `grep`, `find`) inspect workspace content freely; assignment restricts writing, not reading.
- Management capabilities (`list_models`, `validate_member_config`, design/member file writes) are lead-only. Validation never commits or activates anything.
- Custom tool content is readable plain text plus relevant metadata; whole internal result objects are not serialized as the model-facing presentation.
- Explicit commits: implementation-only runs directly, mixed protected/implementation is refused with split guidance, design/member-only waits for user Accept/Deny/feedback. Indirect commits inside scripts are outside this prototype's detection.
- The execute base admits arbitrary Bash for every member regardless of historical `allowedCommands` data; that field remains source-format data with no execution authority.

## Subsystems

- [Harness tools](tools/design.md) — the tool set, invocation authorization, result preservation and custom-tool output principles.
- [Bash](tools/bash/design.md) — persistent shell model, foreground/background execution, output, sandbox resource policy, lifecycle and Git-commit approval integration.
