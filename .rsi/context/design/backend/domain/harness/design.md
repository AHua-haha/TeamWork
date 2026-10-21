# Domain: Harness

## Purpose, responsibilities and boundaries

Harness owns tool selection, file authority mapping, prompt composition, and explicit Git commit approval for members. It decides *which tools a member receives*, *what those tools may touch*, and *which maintenance rules the member follows*.

Harness maps working/dependency design assignments to file write authority, selects the purpose base (management for lead, implementation for workers), grants the execute base (Bash + web tools) to all active members, composes system prompts from fixed bases and supplementary files, and mediates explicit Git commits (implementation-only runs directly, design/member-only waits for user approval, mixed is refused).

Harness never owns Git itself (ordinary project Git is the member's Bash work), never owns the model loop (that's Agent runtime), never makes activation decisions (that's Team), and never persists directly (it uses Storage). Bash execution and web tools remain separate concerns within this system.

## Interface contract

**Purpose and supported interactions.** Harness provides:
- Tool set selection (which tools a member receives based on role and assignments)
- File authority resolution (map working/dependency design nodes to writable/read-only paths)
- Invocation authorization (approve or refuse write/edit/bash/commit requests before execution)
- Prompt composition (assemble system prompt from fixed bases + supplementary files + resolved authority text)
- Commit approval workflow (detect commit type, run directly / refuse / pause for user decision)
- Management capabilities (list_models, validate_member_config — lead-only)
- Bash execution (persistent shell per member, foreground/background jobs, workspace write authority)
- Web tools (web_search, web_fetch with bounded results)

**Required inputs and returned information.**
- `resolveHarness(memberId)` — returns tool set, prompt text, write authority for a member
- `authorizeInvocation(memberId, toolName, input)` — returns permission or named refusal
- `checkCommit(memberId, stagedPaths)` — returns commit type (implementation / design-member / mixed / invalid)
- `approveCommit(memberId, commitMessage)` — executes or pauses for user decision
- `executeBash(memberId, command, cwd?, timeout?, background?)` — runs in persistent shell, returns output/metadata
- `webSearch(query, count?, original_question?)` — returns search results with snippets
- `webFetch(url)` — returns readable Markdown + metadata

**Observable effects.** Harness calls Storage to read member/design records and workspace model settings. Bash writes to the entire workspace and workspace-owned temporary area, reads system resources, and accesses the network through sandbox proxies. Explicit commits create ordinary project Git history. Approval-required commits pause Bash execution and expose a pending request to the user.

**Failure behavior.** Write/edit outside working authority, commits mixing design/member and implementation, invalid tool inputs fail explicitly with named refusals. Bash timeout/cancellation stops the shell and its jobs. Background job failures do not stop the shell. Failed commits write nothing. Pending approvals bound to a run are cleared on cancellation/restart without replay.

## Constraints, specifications and requirements

- Harness imports Foundation, Storage interfaces, Workspace (for design resolution), and Team (for member records)
- Must not import concrete `MySqlStore` or API
- Built-in tools (read, ls, grep, find, write, edit) keep Pi's default operations and native results; authorization happens before invocation, not by replacing filesystem operations
- Bash has deliberately broader authority than file tools; work-scope compliance in Bash is an instruction, not a sandbox restriction
- Historical execute.allowedCommands fields have no execution authority; the execute base is granted to all active members
- Commit detection covers explicit git commit commands, not indirect scripts; hooks are disabled for mediated commits
- Bash shells and jobs survive runs and stop on reset, retirement, affected activation, or shutdown
- Web tools use backend-managed authentication; no API keys in tool arguments
- Custom tool output is readable plain text + relevant metadata, not stringified internal objects
