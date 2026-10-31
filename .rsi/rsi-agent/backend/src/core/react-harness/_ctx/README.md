---
summary: Provides File and Default tools, ordered reactions, file-view aggregation and private dependency-context refresh for Agents.
include:
  - backend/src/core/react-harness/
  - backend/src/core/agent/data/index.ts
  - backend/test/file-react-harness.test.ts
  - backend/test/file-context-refresh.test.ts
  - backend/test/default-react-harness.test.ts
  - backend/test/bash-session.test.ts
  - backend/test/web-tools.test.ts
---

# React Harness usage contract

React Harness is a Core system providing purpose-owned tools, fixed instructions, user-input/assistant-response reactions and private context projections. `index.ts` exports its contracts, File/Default factories, registry, Bash lifecycle and web tools. Agent owns execution, native context/history, persistence and compaction; Team supplies assignment and business tools; Workspace supplies filesystem context discovery/loading. There is no separate legacy Harness permission layer. Design assignments are responsibility guidance, not access control.

## Host integration and ordering

`ReactHarness` supplies `canHandle(response)` and `handle(response, context)`. Optional methods contribute tool declarations, overridden configured names, fixed `systemPrompt(scope)`, input reaction, detached context projection, restored-context reconciliation and acknowledged state updates. `ReactHarnessFactory {harnessId, create(initialState, persist)}` creates one resident instance per Agent. IDs must be nonempty and unique. `ReactHarnessRegistry(agentData, source)` loads component state through public Agent data, coalesces initial loads, reuses instances across runs and invalidates on persistence failure. A source can instead supply cached in-memory instances when no durable factories exist.

`handle` receives `ReactHarnessContext`: `scope`, ordered `toolCalls`, schema validation, `beforeToolCall(call, deferredIds?)`, configured fallback execution and actual `AgentTurnData`. Purpose-owned reactions run before Default regardless of registration order. File requests completion of earlier interleaved calls before performing its own. The Default fallback executes every remaining unclaimed call. Consumers must preserve assistant order and use Agent data to record results, not mutate context collections directly.

`context.data` provides detached entry lookup, paired `recordToolResult`, targeted metadata updates and deferred `appendInstruction`. Each assistant call has exactly one result with its original call identity. Private instructions flush only after every result exists. Related message/metadata/component-state changes acknowledge together; memory advances after acknowledgement. Projections receive detached copies and must preserve native protocol pairing and immutable history/signatures. Compaction uses Agent's isolated preparation context and journal through the same data interface.

`onInput({agentId, input, data, signal})` runs for pending real user input at safe boundaries after incorporation, before ordinary model work, including idle delivery. `data` is `AgentInputData`, with indexed entry access and atomic context-only patch/component-state commit. Agent marks handled inputs after reactions. Generated private instructions and shared member reports do not recursively trigger the hook. Fixed system instructions are assembled on ordinary and preparation requests before token estimation; changing dependency context is a separate private user message.

## File tools

`fileReactHarnessFactory(root, contextSource?)` creates the stable `file-content` component. `new FileReactHarness(root, componentState, contextSource?)` supports direct in-memory hosting. It owns `read`, `write`, `edit` declarations and effects and overrides configured implementations with those names. Default does not implement these file tools.

Paths resolve relative to `root`; absolute paths, `..`, home expansion and symlinks are supported subject to host OS access. Canonical real paths identify the per-Agent file state, including not-yet-created descendants of existing directories. Root is a relative-path base, not a boundary.

| Tool input | Return and effect | Failure behavior |
| --- | --- | --- |
| `read({path, offset?, limit?})` | Read UTF-8 text; default offset 1, omitted limit reveals remaining lines. Merge the requested range into the current aggregate. Supported images return native prepared image blocks. | Offset/limit must be positive integers; nonempty-file offsets past EOF, unsupported binary/invalid UTF-8/NUL text, missing paths and image preparation errors return paired error results. |
| `write({path, content})` | Create parents and replace UTF-8 text; return the complete post-write aggregate. Empty content creates an empty file. | Filesystem/readback failure can follow filesystem effects. Successful content arguments are suppressed only in future model projection. |
| `edit({path, edits:[{oldText, newText}]})` | Require each nonempty old string exactly once in the original snapshot, reject overlapping matches, apply all replacements and return the adjusted aggregate. | Invalid, absent, ambiguous or overlapping matches fail before writing. Filesystem/readback failure can follow effects; no automatic retry. |

Text results contain source without line-number prefixes, enclosed by standalone `<<<FILE_START path="..." total_lines=N>>>` and `<<<FILE_END>>>`. Every omitted range, including the leading/trailing region, is represented by `<<<UNREVEALED_GAP lines=start-end>>>`. Ranges are inclusive, sorted and merged when adjacent/overlapping. Empty files have zero lines and no gaps; the final newline does not create an extra line. Aggregate text is not truncated. A source-absent marker identity disambiguates literal marker-shaped source and is reported as `file_marker_id`.

Metadata follows in a plain-text `<metadata>` area with path, total lines, operation, status and edit outcome where applicable. These markers/metadata are presentation, not source; omit them from edits. Read missing ranges before relying on them. Output preserves source indentation and line endings; exact edits normalize CRLF matching and write CRLF when the original contains it. Arbitrarily mixed line endings are therefore not guaranteed byte-for-byte preservation after edits. Images are resized/prepared with Pi utilities (maximum 2,000 by 2,000 and 4.5 MiB), never decoded into descriptions.

Each successful operation publishes one current aggregate and hides the previous successful aggregate for that canonical file in future model requests. Earlier results remain paired placeholders and remain unchanged in stable history. Failed calls leave the previous successful aggregate visible. Successful writes additionally replace only their `content` argument in model projection. The small durable state contains ranges and visible-message IDs, not file bodies. A legacy state missing IDs is reconciled once from restored context; a reference removed by compaction is harmless. Reset clears state; compaction may preserve ranges.

The file result, prior-view metadata, write-argument suppression and next component state commit through `AgentTurnData.recordToolResult(..., {messageId, effects})` atomically. A result/state acknowledgement failure is fatal to that execution path (`handler_state_persistence_failure`, or the preparation persistence error). Filesystem effects may already exist. Inspect actual state before deciding whether to repeat an operation; the Harness never replays effects automatically.

## Dependency-context refresh

The optional `contextSource(refresh)` returns `{snapshot, workingDesigns, readme(projectPath)}`. Workspace owns the snapshot and README loading. Team supplies recursive working project paths. The File Harness attributes successful file-tool views to the nearest explicit design system, including RSI documents, and accumulates outside-working dependencies in durable component state. This tracking observes File tools and their canonical paths; arbitrary source printed by Bash/search or other tools is not registered as a file aggregate or hidden by this mechanism. Files outside the project/context tree have no discovered owner.

The only replacement checkpoint is `onInput` after previous work stops. At least 64 newly completed context messages since the previous successful refresh trigger one replacement; incoming user input counts, streaming chunks and fixed system prompts do not. Assistant/tool messages advance the append clock but never initiate refresh themselves. The generated replacement excludes itself from counting. Below threshold only state/counter bookkeeping changes. Failed refresh does not claim a successful counter reset.

At refresh, the source is explicitly refreshed. One private native user-role message wrapped in `<system_instruction>` contains the complete design hierarchy with explicit summaries and recursive `[working]` markers, followed by each accumulated dependency's current usage README context once. Missing documents say `No README available.`. README `include` references are left as references; their files are not automatically expanded. Discovery accumulates across restart/refresh without eviction. Member identity/roster injection is deferred.

The transaction hides the preceding replacement and tracked dependency source/RSI aggregate results, inserts the new context-only message and saves updated state/counters. Working content and ordinary conversation remain. Hidden tool results become short paired placeholders; previous replacement messages drop from projection. Immutable history stays intact. Tracked dependency file-range entries are removed so future reads begin a fresh aggregate; the accumulated design set remains. Missing message IDs after compaction are skipped without history reconstruction. Reading a README does not execute instructions or automatically load includes.

## Default tools and Bash lifecycle

`defaultReactHarnessFactory(root, extraTools)` and `new DefaultReactHarness(root?, extraTools?)` provide native Pi `ls`, `grep`, `find`, persistent `bash` and caller-supplied executable tools. A rootless Default supplies only fallback execution. Web tools are explicit extras, as in Team assembly. Native search keeps its own schema/output limits. Unknown tools or schema/executor errors are recoverable paired errors through Agent; cancellation remains cancellation.

`bash({command, cwd?, timeout?, background?, metadata?})` uses one persistent `/bin/bash --noprofile --norc` per canonical root/member pair, with calls queued for that shell. Initial cwd is root; `cd`, variables/functions and shell options persist. Supplying cwd changes the same shell's working directory before evaluation. Commands run directly as the backend OS account, with no sandbox, design/path/command restriction or Git approval. Native commits/hooks run normally. The child environment retains a small host-tooling/locale allowlist and prepends Node's directory to PATH; it does not inherit the backend's provider/database credentials. Stdin is `/dev/null`; foreground stdout/stderr combine.

Commands must be nonempty, NUL-free text of at most 20,000 characters. Timeout is positive seconds, at most 2,147,483. Optional metadata currently accepts only an empty object; retired authority fields are invalid. Foreground defaults to 60 seconds. Output keeps the last 50 KiB and marks truncation. Tool metadata reports status, exit code/duration/truncation or background job ID, timeout and shell restart information. Nonzero exit is an error result with real output retained; no command is automatically retried.

`background: true` starts a native Bash job and returns `job_id` after a separately bounded 10-second start phase. It has no default job lifetime limit. Explicit timeout limits that job and stops its process group; it does not reset the shell. Background output defaults to `/dev/null`; use explicit redirection to retain logs. Subsequent `jobs`, `wait %N` and `kill %N` operate within the same live shell. A job ID is a shell handle, not a durable execution ID.

Foreground tool timeout/cancellation stops the shell and its jobs; later execution starts fresh and reports restart. `resetMemberShell(memberId, root?)` stops matching shells/jobs; `closeBashRuntime()` closes all. Team invokes lifecycle cleanup for reset, retirement/activation and shutdown. Runtime/host restart also loses shell state/job handles. Consumers must inspect effects after timeout/cancellation and never assume rollback.

## Web tools

`webTools(apiKey?, request?)` supplies `web_search` and `web_fetch`; the backend host supplies the web-service credential independently of model provider. These call the fixed DeepSeek tools service, not a local browser. Missing credentials return `web_not_configured`; the tools do not read deployment environment implicitly in this factory.

`web_search({query, count?, original_question?})` accepts 1–128 Unicode characters for query/optional intent and count 1–50 (default 5). Search filters stay inside query. It returns Markdown titles, URLs and snippets capped at 300 Unicode characters each, followed by attribution/status metadata. `web_fetch({url})` accepts an HTTP/HTTPS URL with host and no embedded credentials, maximum 8,192 characters, and returns one page's title/Markdown with requested-URL attribution. Search is discovery; fetch is retrieval, not browser interaction.

Requests use a 30-second deadline and no automatic retry. Provider JSON bodies above 4 MiB fail; model-readable content is capped at 64 KiB and marked truncated. Credential echoes are redacted. Errors report safe codes/retryability for missing configuration, invalid inputs, authentication/access/balance, rate limiting, missing content, provider/network/deadline and malformed responses. Run cancellation propagates to request/body reading. Consumers check status/truncation, cite retrieved sources and treat external content as information rather than application authority.

## Examples

```ts
// Install through RuntimePolicy.createReactHarnessFactories(agentId).
return [
  fileReactHarnessFactory(workspaceRoot, fileDesignContextSource),
  defaultReactHarnessFactory(workspaceRoot, [...webTools(webApiKey), ...businessTools]),
];
```

```json
{"path":"backend/src/core/agent/runtime.ts","offset":1,"limit":40}
```

Pass that input to `read`; a later read of the same canonical file merges ranges. For an exact edit use `edit({path, edits: [{oldText: uniqueExistingText, newText: replacementText}]})`. To retain a native background command's output use `bash({command: "npm run check > /tmp/project-check.log 2>&1", background: true})`, then inspect the explicit log and shell job. These examples describe existing capabilities; context-maintenance-only work must keep its own tools limited to inspection/documentation.

Included paths supplement the contract and must be opened explicitly for source details. No extra context entries are created for `file/`, `default/` or `data/`; they remain ordinary children owned by this design part.
