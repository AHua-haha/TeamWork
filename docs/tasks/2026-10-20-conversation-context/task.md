# Conversation context management

Status: complete
Task start commit: 3ad3152567097f881fda11809675687246ebc258
Review boundary: [Conversation context management draft](drafts/workspace-agent/team/conversation-context/design.md)

## Design outcomes

- [delivered] One authoritative group context and independently maintained member contexts, comprising previous result context and configured automatic retrieval.
- [delivered] Timeline-based construction: earlier group context + previous result context + incoming group messages + automatically retrieved context.
- [delivered] Every stopped run retains its result context and advances that member's dividing point, including failed runs with unfinished work.
- [delivered] Failed activations retain their private working-message ranges for the next activation, accumulating across consecutive failures. Successful completion clears these ranges from future model context and leaves the implementation document as result context; stable execution history is preserved.
- [delivered] Private working history, retained failure-range membership, dividing points and successful cleanup are durable across backend restarts. Recovered unfinished runs preserve their recorded working messages for the next activation without automatic execution replay.
- [delivered] Agent-maintained Markdown member-context documents under implementation context: result summary, file lookup table and designated JSON automatic-retrieval configuration. Runtime loads the document text and executes full Bash-tool input objects; lookup targets are not automatically loaded.
- Implementation authorized: replace the append/interleave model and verify the complete lifecycle before promoting canonical contracts.

## Decisions and open questions

The user agreed on group context, member context and working context as distinct terms. Group context contains user messages and accepted member final responses, with sender and mention metadata. Members consume this shared state rather than maintaining individual group-context copies. Their own member contexts remain independent.

Construct working context as group messages through the previous run's dividing point, then that run's result context, then incoming group messages through activation, then freshly retrieved context. Automatic retrieval is configured for the member and may, for example, run a validation command. Its configuration and generated information are distinct. A member without a prior run has no earlier group portion or previous result; its incoming portion contains all group messages through activation. Shared messages arriving during execution do not enter that run's ongoing working context.

Amendment: the dividing point follows each stopped run and its retained result context, independently of accepted final publication. The group context supplied to that run is considered processed: its information is represented in the result context, including unresolved work and failure information. Failed working-context information becomes the new result context and the dividing point advances. This supersedes the earlier decision that failure left the point unchanged. Unincorporated group messages remain incoming. Dividing-point semantics are settled; durable backend bookkeeping and restart recovery are implementation responsibilities. Interrupted-exchange model validity remains to be designed.

Member-context format decision: use Markdown with Result summary, File lookup and Automatic retrieval sections. The lookup table contains paths/descriptions, with no automatic reading of the referenced files. A designated JSON block holds commands as complete existing Bash-tool input objects, including optional cwd, metadata, timeout and background. Runtime uses the same schema, defaults, persistent member shell, harness authority and result format as an agent invocation. Execute entries sequentially in listed order; background entries return their normal launch results without waiting for completion. Agent maintains these documents with common file tools under existing implementation-context authority; no dedicated tools for registering/removing file entries or retrieval commands are introduced.

Failure-retention decision: retain the failed activation's recorded private working messages, from its private-work start through its last recorded message, including recorded automatic retrieval results, assistant messages and tool calls/results. Shared group messages are separately reconstructed from authoritative group context. Keep earlier retained failure ranges across consecutive failed runs. On success, remove their participation in future model-context construction and use only the maintained implementation document as member result context; do not delete stable history. This resolves the earlier conceptual retention/cleanup question without requiring successful summary generation after a failure. Durable range bookkeeping is an implementation responsibility; interrupted-exchange recovery behavior remains open.

Durability decision: private working-message history and the state identifying which failed ranges remain in future context must survive backend restart. Dividing-point advancement and successful retained-range cleanup also survive restart; cleared ranges must not reappear as model context. Startup recovery of an abandoned run retains its recorded private range as unfinished work for the next trigger, while keeping existing interrupted status and no automatic replay. Temporary uncommitted streaming chunks remain under the existing transient-progress contract. This decision concerns recorded history, not replaying partially executed external effects.

The prior append/interleave context model is replaced by this candidate. Canonical documents are promoted alongside code at commit preparation; task drafts retain the design record.

### Prototype defaults selected for implementation

1. Initial state: the document entry point is settled as impl/README.md under the corresponding implementation-context node. Bootstrap has an initialized summary/lookup and commands: []; multiple assigned working-design documents load in normalized path order.
2. Invalid documents/retrieval: expose readable diagnostics for missing/invalid documents, execute no commands from an invalid document, and continue model execution on ordinary retrieval errors. Storage/ownership failures remain terminal.
3. Interrupted exchanges: restart durability and recovery of recorded failed/abandoned working ranges are settled. Cancellation retains committed private work as for failure. Missing tool results become context-only explicit errors, preserving immutable history and transient partial-stream behavior.
4. Successful document handoff: harness instructions require an up-to-date summary before finishing. No automatic prose-completeness or modification-time gate. Terminal publication/failure updates durable boundaries atomically; success excludes prior private ranges.

Document-path decision: use impl/README.md under the corresponding implementation-context node. The user confirmed that the dividing-point behavior is already settled; it is removed from open design decisions. Implement its existing stopped-run/result-context rule without reopening the behavioral choice.

## Checkpoints and remaining work

- Recorded and amended the agreed concepts, timeline composition, stopped-run lifecycle, Markdown document format, Bash-compatible automatic retrieval, failed working-message retention and success cleanup in the proposed design.
- Candidate verified and ready for the consistent task commit. No required implementation work remains. Automatic compaction/token-budget policy remains deferred as planned.
- Code and canonical documents agree with the final task drafts. No push, merge, live workspace reset or personal-project file migration performed.

## Implementation decisions

- Read assigned working-design impl/README.md documents in normalized path order. New workspace bootstrap uses directory form. Existing documents are not silently moved; absent/invalid documents become private repair diagnostics with no retrieval from the invalid document.
- Parse exact level-two sections outside fenced examples. Validate all commands in a document before executing any; recoverable retrieval errors become recorded private input and allow the model to repair.
- Freeze the shared prefix at durable admission. Terminal transactions advance the processed prefix and retain failed history or clear retained ranges on success. Waiting runs cancelled before context preparation do not consume a context boundary.
- Cancellation and restart interruption retain committed private messages. Missing tool results are represented by explicit synthetic error results in the constructed context only; immutable history is unchanged and no command is replayed.
- Harness prompts require updating summary/lookup before a successful final response. No prose-completeness or modification-time gate. Invalid documents remain repairable through normal agent tools.
- No public API or frontend transport changes. Existing conversations retain stable history; first new activation constructs from shared history and failed runs since the last successful run.

- Removed obsolete automatic source-file preloading from harness prompt assembly. Source mappings still define unchanged file authority; source contents are read on demand rather than defeating the lookup-table contract. Renamed the role/roster prompt assembler to MemberInstructions to keep it distinct from conversation context.

## Candidate realization

ConversationContext loads exact assigned impl/README.md files, parses summary/lookup and JSON full Bash inputs, prepares SQL model context once and records fresh retrieval through the runtime. MySQL stores member processed/successful-history boundaries and per-run admitted shared/private bounds. Failure/cancellation/interruption retains stable working history; success excludes it without deleting records. Interrupted tool calls receive context-only error results. Role/roster prompts are separated as MemberInstructions. Source code is read on demand. Public HTTP and frontend stream contracts are unchanged. New workspace bootstrap uses directory context form; old documents and project files are preserved.

## Verification and review

- Backend: 183 unit/HTTP tests, 63 disposable MySQL integration tests and TypeScript/production build passed.
- Frontend: 83 regression tests and production build passed; public API/stream envelopes unchanged, no UI implementation change.
- New coverage: document parser and full Bash shapes; exact group/document/failed/incoming/retrieval order; no lookup-target/source preloading; repeated failures once; durable failed ranges and successful cleanup across reopen; abandoned-run interruption with missing-tool context repair; retrieval error/invalid-document handling; conversation reset and new bootstrap paths.
- Documentation audit: 18 canonical/draft documents agree, local links resolve and obsolete fanout/import paths are absent. See tests.jsonl for all checks, including initial failures and subsequent passes.
- Review on the existing codex/lead-harness branch in the project base folder. Restart backend to load the new module/prompt/schema version. Existing source files, context documents, stable chat/private history and provider/member settings are preserved. The migration initializes member boundaries without using old interleaved context copies; old impl.md files require explicit conversion to impl/README.md by normal file tools, with readable repair feedback.
- Recorded private messages are durable; uncommitted stream deltas remain transient. No token-budget/automatic compaction policy is added. Missing/invalid documents allow repair rather than silently overwriting files. Successful document maintenance is an instruction, without a semantic prose validator.
- Pre-existing unrelated untracked .claude/ and backend Finder metadata remain untouched.
