<!-- Task proposal; current contract is under docs/systems/ -->
# Harness tools

## Purpose and boundary

Provide reusable tools for agents assembled by the harness. Reuse Pi's built-in tool contracts and default operations wherever they fit. Customize capabilities that require project-specific behavior, including Bash execution and scoped Git control.

The harness selects tools and authorizes invocations. It does not implement permission control by replacing the filesystem operations used by the built-in tools. Tools remain independent of a particular agent; the backend binds the caller's identity and authority.

This contract defines tool integration and result principles. Bash supplies persistent execution, shell/job behavior and resource policy. Bash lifecycle/Git behavior and the file-tool invocation boundary are specified by this contract and its Bash child.

## Inputs and preconditions

### Tool set

| Tool | Intended integration |
| --- | --- |
| read | Pi built-in, default operations and native result |
| ls | Pi built-in, default operations and native result |
| grep | Pi built-in, default search operations and native result |
| find | Pi built-in, default search operations and native result |
| write | Authorize the target, then invoke Pi built-in unchanged |
| edit | Authorize the target, then invoke Pi built-in unchanged |
| bash | Customized; per-member shells, native jobs and broad workspace-write/system-read/network sandbox policy |
| web_search | Existing project capability; custom output follows the principles below |
| web_fetch | Existing project capability; custom output follows the principles below |
| list_models | Existing management capability; custom output follows the principles below |
| validate_member_config | Existing management capability; custom output follows the principles below |

The harness grants tools according to their purpose. Model discovery and member validation retain their management authority. No PowerShell or additional editing engine is introduced.

### Invocation authorization

- read, ls, grep and find are freely available for reading workspace content without working/dependency design restrictions.
- write and edit require the requested target to fall within the caller's working-design write permissions, including role-specific design/member editing grants. These invocation checks remain in place even though Bash has broader write authority. Application-level design/member acceptance and activation remain distinct operations; these workflow checks do not prevent equivalent direct Bash changes.
- The harness checks the built-in tool name and input before execution. A denied mutation does not invoke the tool.
- Allowed built-ins execute with their default operations. No injected access/readFile/writeFile/mkdir/exists/stat/readdir/search permission implementation is used.
- Caller identity, workspace and authority come from backend execution context, not agent-supplied identity fields.
- Bash is separately sandboxed: it may write the entire workspace and workspace-owned temporary directory, read system resources subject to OS permissions, and access the network. It has no additional executable control and no working/dependency-design write restriction.

Working/dependency design assignments continue to define work responsibility and write/edit input authority. Freely reading another subsystem does not grant ownership. Bash deliberately has broader filesystem authority, so those file-tool checks are not a claim that the member cannot modify another subsystem through Bash. Work-scope compliance in Bash is an instruction rather than a sandbox restriction.

## Outputs and observable effects

### Preserve Pi results

Built-in tool content and structured details are returned and recorded without a project-level result rewrite. Keep Pi's native output layout, success confirmations, error information, truncation limits and continuation notices. Do not add another metadata footer, line-numbering transformation or truncation pass around the built-ins.

Pi owns the built-in schema, description and operation behavior, including edit matching and batch replacements. There is no new project edit algorithm in this design.

### Custom-tool content

The conceptual format of model-visible content is **plain text plus relevant metadata**:

- Main content is readable operation output: a command's output, a web page, search results, a model list or validation findings. Markdown is acceptable.
- Supporting information may include status, source attribution, retrieval time, truncation, continuation, exit status and useful error information.
- This is not a universal serialized envelope. There is no requirement for every tool to use the same fields, a mandatory metadata section or XML tags.
- Existing web tools can keep a readable Markdown body and their metadata block.
- A custom tool should not stringify its whole internal result object as its model-facing presentation. File/command content that naturally contains JSON is still valid content.
- Structured details is separate application metadata for durable recording and frontend rendering. It is not automatically dumped into model-visible content. Information the agent needs must be present in content.

### Truncation ownership

- Pi built-ins retain their native truncation policy, including whether they retain the beginning or end and how they report continuation or retained output.
- Custom tools own suitable bounded output policies and explicitly report shortening and recovery information where available.
- No additional common truncation implementation or global metadata byte budget is introduced by this agreement.
- Bash keeps the last 50 KiB without creating an output file. Web tools keep their existing bounded HTTP/output policies. Model discovery is bounded by the existing 50-model catalog and validated field sizes; member validation reports at most 50 KiB with a visible truncation notice and counts. No additional shared truncation pass or universal metadata budget is used.

## Failure behavior

Invocation refusals and tool execution errors produce recoverable, call-associated tool error results for the agent. Preserve native tool error information and structured details when present. Do not mark an actual failure successful merely because it is represented as readable content.

The agent loop can continue with the result and choose a repair, another operation or a limitation report. There is no automatic retry. Cancellation, persistence failure and runtime ownership loss retain their existing runtime semantics.

A failed operation does not imply rollback of filesystem changes already made. Input authorization and default filesystem operations are not a transactional or OS isolation guarantee.

## Guarantees and limits

- Default operations means actual Pi defaults, not permission-enforcing replacement operations hidden behind an adapter.
- Built-in tool behavior and results follow the installed Pi version; implementation must verify the actual installed interfaces.
- No HTTP filesystem operation service is required between tools and harness.
- No new tool for checkpoints, approval, activation or final response is introduced.
- Pi file-tool inputs must resolve inside the workspace. Existing ancestors that resolve outside it are refused. write/edit targets may not traverse symbolic links. These input checks are not OS isolation against concurrent broad Bash mutations; search tools preserve their native traversal/ignore behavior.
- Bash input/output, shell/job behavior, resource policy and lifecycle are defined in the Bash contract. Optional scoped Git is a workflow feature; raw Bash/native Git have the deliberate broader workspace authority.

## Acceptance examples

1. A worker reads or searches project content outside its assigned designs using a read-only built-in. Its assignment is not used as a read filter.
2. An authorized edit invokes Pi's built-in replacement logic with default operations and preserves both content and details.
3. An edit targeting a path outside the member's writable scope is refused before Pi executes it.
4. A large built-in read is truncated by Pi and retains Pi's continuation notice, without a second wrapper truncation or appended project metadata section.
5. A custom web result contains readable page/search content and relevant attribution/truncation information, with no outer JSON-string envelope.
6. The built-in edit returns a structured diff in details; recording the result preserves that data instead of discarding it or automatically inserting the full diff into model-visible content.
7. A custom tool fails, the runtime records an error result and the agent receives an opportunity to recover in the same run.
8. A worker's edit target is outside its working-design write scope: refuse that file-tool invocation. The same worker can modify that project path through Bash when it is inside the workspace; the distinction is intentional.
