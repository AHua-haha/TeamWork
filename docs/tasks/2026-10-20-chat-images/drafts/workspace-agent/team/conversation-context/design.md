<!-- Task proposal; current contract is under docs/systems/ -->
# Conversation context management

## Purpose and boundary

Construct a member's model-facing working context from one authoritative group context, its file-maintained result context and fresh retrieval information. Preserve unfinished private work across failed activations and backend restarts; after success, use the implementation document for continuity. Context maintenance does not rewrite stable conversation history or group presentation.

### Terms and ownership

| Term | Meaning | Owner |
| --- | --- | --- |
| Group context | Ordered accepted user messages and member final responses, including identity, sender, mention recipients and order | Group chat |
| Member context | The member's implementation-document result context, configured automatic retrieval and any retained unsuccessful working ranges | Member, with backend retention |
| Result context | State after its previous run, represented by the maintained document and, after unsuccessful execution, retained private working messages | Member |
| Retrieved context | Fresh results of configured Bash invocations for this activation | Runtime through the member harness |
| Working context | The composition used for this activation, extended by its private model/tool loop | Member execution |
| Conversation history | Stable shared records and private completed execution messages | History system |
| Dividing point | Group-message prefix processed by this member's latest executed stopped run | Backend, advanced with retained result state |

Members consume group context without maintaining individual delivery copies. Member-private working messages never enter another member's context. Project design and implementation documents remain organized by system/design; current assignments select which implementation documents are loaded. Harness instructions and tools are supplied separately as the system environment.

## Inputs and preconditions

- Existing team admission identifies the member and durably freezes the shared prefix through the triggering publication. Only actual execution initializes working context; a waiting run can be cancelled without processing group messages.
- Working-design assignments resolve through accepted designs. Each corresponding implementation node uses impl/README.md as the entry point. The root is .rsi/context/implement/impl/README.md; backend is .rsi/context/implement/backend/impl/README.md.
- Load distinct entry points in normalized path order under the member's existing implementation-context read authority. Dependencies are not automatically loaded as member documents.
- New workspace bootstrap creates the root README with empty retrieval configuration. Existing impl.md files are preserved, with no fallback or automatic conversion. Missing/invalid README content produces a private repair diagnostic and no retrieval from that document.

## Outputs and observable effects

### Document format and maintenance

Use a Markdown document with these exact level-two headings outside fenced code examples:

````markdown
# Implementation context

## Result summary

Current implementation state, completed results, unfinished work and known problems.

## File lookup

| Path | Description |
| --- | --- |
| backend/src/team.ts | Member identity and lifecycle |

## Automatic retrieval

```json
{
  "commands": [
    { "command": "git status --short" },
    { "command": "npm test", "cwd": "/workspace/project/backend", "timeout": 60 }
  ]
}
```
````

The absolute cwd is an example; use the real workspace path. Additional documentation sections are allowed. Preserve existing implementation-document obligations: the Implemented contract clearly documents actual Input, Output, Effect and Usage examples, in this README or additional impl/ Markdown documents.

Only Result summary and File lookup text is loaded as document result context. The table's target files are not read automatically. Agents may inspect them using common tools when needed. Automatic retrieval is parsed separately; prose/example commands are not execution configuration.

Automatic retrieval contains exactly one fenced json block with {"commands": [...]}. Duplicate sections, missing required sections, unclosed fences, malformed JSON and invalid Bash inputs are document errors. Validate all entries in a document before running any of its commands. An invalid document yields a readable private repair diagnostic and executes none of its retrieval. Other valid documents still supply their content/retrieval. There is no command interpretation from Markdown examples.

Agents maintain the README using common file tools and existing working-design permissions. There are no dedicated context-file-entry or retrieval-command add/remove tools. The harness instructs the member to update the summary and lookup before its successful final response. It does not use a semantic prose-completeness or modification-time gate. Missing files must be created/repaired by the member within its existing authority. Directory form excludes simultaneous impl.md and impl/ content; conversion must preserve useful existing information.

### Automatic retrieval

Each commands entry is a full existing Bash-tool input:

```typescript
{
  command: string;
  cwd?: string;
  timeout?: number; // Seconds
  background?: boolean;
  metadata?: { git?: { scope: string } };
}
```

Use the same Bash implementation, schema validation, persistent member shell, harness permissions, defaults, output truncation and plain-text-plus-metadata result as agent-issued calls. Execute entries sequentially, once per activation before its first model request, in document/entry order. Omitted cwd retains normal persistent-shell behavior: a fresh shell starts at the workspace root, later invocations retain its current directory. No separate retrieval shell or automatic retry exists.

Normal command results and recoverable invocation errors become durable private input records with document path and Bash input metadata. They are appended as retrieved context after incoming group messages. Command failures allow the model loop to inspect/repair; cancellation, storage failure and loss of runtime ownership retain terminal behavior. Commands may modify shell state and workspace files under normal Bash authority. Effects are not rolled back.

A background entry returns launch status and native job_id without waiting for job completion. Existing redirection, /dev/null output defaults and job management apply. Later output is not automatically fetched. New retrieval occurs on each later trigger, while restart recovery itself does not execute commands.

### Working-context order

```text
Group messages through this member's previous dividing point
+ Assigned README Result summary and File lookup text (or repair diagnostics)
+ Retained private working messages from unsuccessful activations, if any
+ Incoming group messages after that point, through this admission
+ Fresh automatic retrieval results
```

Each shared message keeps identity, author, recipients and order. It appears once in the selected group prefix. Lookup target contents are excluded. Before the first executed run the earlier group portion and retained private ranges are empty; an initialized document is still loaded and all admitted group messages are incoming.

During the run, the normal model/tool loop extends this stored working context with private execution messages. Group messages accepted after admission are available for the next activation; they do not enter the ongoing run. A member's own subsequently published final response is also available in that later incoming portion, since the processed boundary covers the shared prefix supplied at admission.

### Stop, failure and success

Every executed stopped run advances the dividing point through its supplied group prefix, in correspondence with retained result state. Processed means incorporated into that state; it does not assert task success. Unincorporated later messages remain incoming. A waiting run that never initializes context advances no boundary.

On failure, cancellation or startup interruption, retain the activation's recorded private working-message range alongside the document. The range begins with private execution/retrieval for that activation and ends at its last recorded message. It includes completed assistant messages, tool calls/results, recorded retrieval and private feedback. It excludes shared messages and document entries already reconstructed separately. Consecutive unsuccessful runs retain all ranges since the last success once, in execution order.

On success, remove all private working ranges from future context construction, including the successful trace. The implementation README becomes the sole member result context; automatic retrieval remains configured and runs afresh next activation. Immutable private history, public final references and presentation working-history ranges remain inspectable. Success cleanup is durable and does not delete history.

Accepted final publication appends the exact referenced response body to group context through existing team rules. Publication refusal remains private and allows same-run revision; it is not run termination. Stopped runs without accepted finals do not fabricate shared responses.

### Durability and recovery

Private completed working messages, retained-range membership/order, dividing points and successful cleanup survive backend restart. Recover these consistently with terminal run state. Restart must not lose recorded unsuccessful work or resurrect private ranges excluded by a prior success.

Startup marks abandoned runs interrupted and makes recorded private work available at the next trigger. It does not replay model calls, commands or external effects. The retained history is the durable source, without a second copy of every failed message.

If execution stopped after recording a tool call but before recording its result, context construction inserts an explicit error result for the missing call. It states that execution stopped, effects may exist and the command was not replayed. This is a context-only repair; stable history remains unchanged. Normal tool results are preserved exactly. Temporary uncommitted streaming chunks remain transient and may be lost on restart.

## Failure behavior

- Invalid/missing member documents are private repair diagnostics; commands from those documents do not run. Existing documents are not silently overwritten or converted.
- Ordinary retrieval failures become recorded results for the model to handle. No automatic retries or rollback.
- Cancellation aborts retrieval/model/tool work under existing lifecycle rules and retains recorded private work for executed runs. A cancelled waiting run has no processed prefix or file checkpoint.
- Storage/runtime ownership failures are explicit and cannot claim context finalization without durable state. Existing terminal persistence failure/restart recovery applies.
- Context-only missing-tool errors do not imply the tool had no effects and never cause automatic replay.
- Explicit idle chat reset clears group/private history, retained-range markers and processed boundaries under the existing cursor reset contract. Project/context documents and their configured retrieval remain preserved.

## Guarantees and limits

The following dependencies retain their existing boundaries: team mentions/admission/budgets/publication and sequential workspace execution; one runtime model/tool loop; harness tool authority and file-maintained rules; project design/mapping/approval policy; stable history and final references; compact temporary streaming and frontend transport; explicit reset and provider/member settings.

The former per-member append/interleave delivery model is replaced. Member model context is assembled for each run and cleared when that run terminates; durable boundaries/history and maintained files provide subsequent reconstruction. Public APIs and frontend streaming envelopes are unchanged. Retrieving a document follows existing 1 MiB text/path safety; normal Bash output/time limits apply. The shared transcript and retained failed private ranges are not automatically summarized or token-trimmed. Provider context-window limits remain relevant. No automatic compaction, knowledge system, semantic summary validator, public context-edit API or durable in-flight chunk storage is added.

Startup initializes new member-boundary records for existing members from their last completed successful run's private-history end, preserving existing stable history and project files. Their initial processed group boundary is empty so the first new construction reads shared history without relying on old interleaved copies. Existing admitted runs retain stable interruption handling; no old conversation replay occurs.

## Acceptance examples

1. A stopped run processed G1..G2. With document D, failed private range F, incoming G3..G4 and retrieval R, the next context is G1 + G2 + D + F + G3 + G4 + R. Its lookup table is present; referenced file contents are not loaded.
2. A fails twice. Both private ranges survive restart and appear once in its next context. A successful run then excludes those ranges from later input, even after another restart; their stable history remains inspectable.
3. B publishes while A is running. A receives no mid-run insertion. The message remains in authoritative group history for A's next activation.
4. A document's second command has an invalid Bash field. No command from that document executes; the model receives a repair diagnostic and can use ordinary file tools.
5. A configured command exits nonzero. Its normal readable error result is stored, and the member can continue. A background command supplies its launch result, not its eventual output.
6. A recorded Bash call has no result at restart. The next context contains a missing-result error without changing history or executing Bash again.
7. New workspace bootstrap supplies root impl/README.md with empty commands. A workspace with only old impl.md receives a missing-entry diagnostic; its files are preserved for agent/user repair.
8. Idle chat reset removes retained private history and boundaries. It preserves implementation README files and retrieval configuration; the next activation loads them with only new shared messages.

## Shared user pictures

Shared user messages can contain ordered pictures alongside text. Construct the corresponding user context entry from its group text/identity/mention information and the same prepared native image blocks. Resolve picture references from durable storage during context preparation; never replace pictures with generated text descriptions. Preserve the group message position and image order across subsequent runs/restart. These shared pictures are separate from private tool-read image results. A model request containing images requires an image-capable model and otherwise fails explicitly.
