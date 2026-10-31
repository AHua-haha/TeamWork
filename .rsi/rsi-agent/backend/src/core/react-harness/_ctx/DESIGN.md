# React Harness

## Purpose, responsibilities and boundaries

Provide capabilities, instructions and rules for a purpose, react to user-input messages and assistant-response messages, and maintain the related private context and durable state. React is the verb describing reaction. This system is a sibling of Agent, Team and Workspace under Core.

Agent owns how an agent runs, native messages/context/history, durable data operations and compaction lifecycle. React Harness owns what capabilities are provided and how its context/state is maintained. Team owns member assignments, configuration and cooperation; Workspace owns project registration/context documents. Initial implementations are File React Harness and Default React Harness. Tools currently execute without design/path, command, sandbox or Git approval gates; ordinary schemas, errors, timeouts, cancellation and host OS behavior remain.

## Interface contract

React Harness supplies tool declarations, user-input and assistant-response reactions, fixed system instructions, dynamic private context/instructions and optional model-context projections. A host assembles purpose-specific instances for an Agent. The public entry is `core/react-harness/index.ts`. Related implementations, contracts, residency, tools and Markdown instructions live beneath that directory, organized by purpose.

The host supplies the actual Agent data model for the assistant turn, plus tool-validation/execution/sequencing capabilities and execution metadata. React Harness uses public data-model operations directly for context/history lookup, targeted metadata changes, paired results, deferred private instructions and acknowledged related-state commits. It does not require a runtime-owned context-operation proxy or import Agent execution implementation. Agent data is the shared contract. React Harness owns its state schema/meaning while generic component-state persistence and atomic message transactions belong to Agent's data layer.

Respect assistant call order, exactly one paired result per call, cancellation, incremental context writes and acknowledgement before publishing memory/state. The Default fallback runs after purpose-owned reactions independently of registration order. Instructions are buffered until all tool results are present. Context inspection and projection never rewrite immutable history/provider signatures. Compaction uses the same model operations on an isolated preparation context/journal and prepared related state, leaving ordinary context and live related state untouched until successful acknowledged cutover.

### File React Harness

File React Harness defines `read`, `write` and `edit` itself: schemas, descriptions, filesystem effects, aggregation and paired native tool results. These tools are declared and executed by the File React Harness; there is no additional standalone executor for its file operations. The File React Harness uses ordinary filesystem operations directly. It operates directly without legacy Harness file capabilities, MemberFiles, design-scope enforcement or workspace/path permission checks. Workspace root resolves relative paths only; absolute paths and paths outside that root are valid. Bash and other capabilities follow the same unrestricted development permission policy through Default React Harness.

Read ranges are 1-indexed, sorted and merged when overlapping or adjacent. A text read adds its requested range to the revealed set. Exact-string edits support multiple non-overlapping replacements against the original file; successful edits shift previously revealed ranges and reveal affected post-edit lines. Writes replace the file and reveal its complete content. Empty files have zero content lines. Images read through this tool remain native image blocks prepared with Pi's image utilities; they are not converted to descriptions or UTF-8 text. Tool descriptions state the actual React Harness behavior instead of inheriting unused native tool limits.

Read and edit results contain the current aggregate of revealed text ranges as plain source text without line-number prefixes. Preserve source indentation, blank lines and line endings. Delimit the view with standalone `<<<FILE_START path="..." total_lines=N>>>` and `<<<FILE_END>>>` markers. Represent every unrevealed region with `<<<UNREVEALED_GAP lines=start-end>>>`, including leading, internal and trailing gaps; ranges are inclusive actual file line numbers. Merge overlapping and adjacent revealed ranges. A newline may be added only to separate source from a following marker. Empty files have zero content lines and no gaps. Successful writes use the same format and contain the complete post-write file. If source contains marker-shaped lines, add a source-absent marker identity to generated markers and report it in result metadata, preserving literal source unchanged. Results end in a plain-text `<metadata>` area identifying path, total lines, operation, status and edit outcome when relevant. Errors are recoverable paired results with readable error text. Filesystem effects may precede a persistence failure and must never be replayed automatically.

The File React Harness owns a required file-maintained instruction prompt explaining aggregation, content boundaries, gaps, source preservation, exact-string editing and view replacement. Agent assembles React Harness-provided instructions into the system prompt on every ordinary and compaction model request, before token estimation. Team does not maintain or append duplicate File React Harness rules. Generated markers and result metadata are not source text and must be excluded from edits; unrevealed regions must be read before relying on their contents.

Tool-use guidance prefers read, edit and write for ordinary file operations and batches multiple ready calls in one assistant response. Execution remains sequential in response order; calls whose arguments depend on new results wait for those results. Bash is the normal choice for directory listing, discovery, text/code search and structural matching, and remains available for file reads and scripted edits when useful. This is a preference, not permission enforcement or removal of native ls/grep/find capabilities. After Bash edits a file needed for continued work, read refreshes its relevant tracked content. File owns the detailed guidance; Default's instructions remain consistent with that preference.

Maintain one visible aggregate per file per Agent. The File React Harness's small durable state maps a canonical absolute file path to revealed ranges and `visibleMessageId`; it stores no file contents or message copies. Each successful file operation records an aggregate and replaces the previous visible reference. Earlier successful results, including those in the same assistant response, remain intact in immutable history but are projected as short placeholders in later model requests. Failed operations do not replace or hide the last successful aggregate. Every call retains its native call/result identity and operations execute in assistant order, including interleaved Bash or other tool calls. Successful write arguments are suppressed only in model-facing projection.

Use the stored previous message ID and Agent's resident message-ID index to update its visibility directly, without scanning context/history. If compaction removed that entry, treat the reference as absent and replace it on the next successful view. Reset clears React Harness state; compaction publishes file-view references and revealed ranges only as part of prepared state consistent with the retained context. Existing legacy state without message references is reconciled once when the Agent context is restored, not per operation.

Normal persistence inserts only new stable-history/context rows and updates only affected existing context metadata, without reserializing their message bodies or loading/replacing the entire context. The small React Harness state is saved as a whole object. Record the new aggregate, hide the previous aggregate, suppress successful write arguments when needed, and replace React Harness state in one transaction. Advance in-memory context and React Harness state only after acknowledgement. Rollback publishes no speculative state; uncertain acknowledgement invalidates residents and never retries filesystem effects.

During compaction prepare both the replacement Agent context and the matching File React Harness state, using the preparation context's own message-ID index. Preparation operations journal their messages, targeted metadata changes and prepared state without advancing live Harness state independently. File-view references, revealed ranges, replacement-message references, visibility metadata and counter bookkeeping must describe the proposed retained context.

On successful compaction, publish the replacement context, its metadata changes and the prepared File React Harness state in one acknowledged transaction; advance their resident models only after that acknowledgement. Preserve accumulated dependency discovery across compaction: preparation begins with the existing dependency set and may add discoveries, rather than rebuilding or replacing that set from only the retained messages.

If preparation fails or is interrupted before successful cutover, discard its proposed context replacement, metadata changes and prepared Harness state. The previously committed context and Harness state, including all previously accumulated dependencies, remain authoritative. Recorded preparation history is not rewritten or replayed; discarding preparation does not undo filesystem or other external effects. If commit acknowledgement is uncertain, restore the durable outcome before deciding which state is current, without a competing replacement or automatic replay. Original history bodies and metadata remain immutable. Full context replacement remains reserved for successful compaction or explicit reset/replacement.


### Default React Harness

Provide native Pi ls/grep/find, persistent Bash, web search/fetch and caller-supplied business tools. Preserve their existing execution, output/truncation, recoverable error, background-job and timeout behavior. Default supplies fallback execution for unclaimed configured tools. Team supplies model discovery/member validation tools and working assignments; this is not member-owned Harness configuration. Bash runs directly as the host account with filtered child environment and no sandbox/Git interception. Context reset, retirement/activation and shutdown stop shell resources without requiring Workspace enumeration.

### Related state and residency

Reuse instances across runs, restore their small state once from Agent's component-state data and invalidate them after uncertain acknowledgement. File retains the stable `file-content` identity. Message insertion, visibility metadata and component-state changes acknowledge atomically. Existing table names, IDs, message bodies/signatures and data formats remain unchanged. No reset, automatic tool replay or new SQL schema is introduced by directory reorganization.

## Constraints, specifications and requirements

Keep this dependency direction: React Harness depends on public Agent data-model types/operations; Agent data does not import concrete React Harness implementations. Agent runtime imports React Harness's public integration interface. Business tools may be supplied by other owners without giving React Harness foreign schema knowledge. Context maintenance must use acknowledged data operations rather than mutating raw collections before persistence. Purpose-owned model projections operate on detached copies.

Member designScope remains Team-owned assignment guidance, with recursive working roots only; dependencies are discovered dynamically. There is no member Harness configuration or legacy resource inspection. Future permission and member-specific Harness configuration require separate design.

### Fixed instructions and dynamic context

React Harnesses have two conceptual prompt contributions: stable system instructions, and changing context or runtime-generated private instructions produced while reacting to execution. Agent assembles fixed system contributions. Purpose-owned reactions can append private instructions through Agent turn data after paired tool results; input reactions use Agent input data at the safe boundary below.

File React Harness owns file-tool instructions, project-context organization/maintenance rules, and the working-design/dependency usage README context responsibility. Fixed context-maintenance rules belong in its system contribution. Working DESIGN documents and dependency README/included source are changing information: remove their current system-prompt embedding. The user-input refresh design below defines the changing design/dependency context and its checkpoint. It uses a private user-role message; the exact hook API and concrete durable schema remain implementation choices. Default React Harness owns only instructions about its capabilities, tool behavior and execution lifecycle, without Team configuration rules or Workspace guidance assembly.

### User-input reaction and dependency-context refresh

This extends assistant-response reaction with user-input reaction before ordinary model work.

#### Ownership and member assignments

React Harness reacts to user-input messages as well as assistant responses. Once incoming user input is incorporated into the member's private context, its input reaction can inspect/manipulate effective context, insert private instructions and maintain acknowledged related durable state before ordinary model work starts. Preserve existing safe input boundaries: do not interrupt an active model/tool sequence or insert a reaction between a tool call and its paired result. Team continues to own original shared input and immutable group history; the reaction changes only the receiving Agent's private model context.

Member configuration assigns working designs only, including descendant design parts recursively. Remove configured dependency design scopes. Members can freely inspect other design systems as their work requires. File React Harness owns discovery and refresh of their context. This is context maintenance, not a read-access or implementation-permission boundary.

#### Discovery and durable state

Track design systems outside the member's recursive working scope whose source or RSI context the member has viewed. Attribute files/context documents to their owning design parts and deduplicate discovered dependencies by design system. The discovered dependency set accumulates across multiple refreshes and successful compactions. Compaction must preserve the existing accumulated set, including dependencies whose source messages are not retained. Do not prune or evict it in this prototype; dependency cleanup policy is deferred.

Retain discovery state, the successful-refresh marker/counter and the previous generated-context reference in File React Harness's related durable state. Backend restart must preserve these facts. Reuse existing file-view/message references and Agent data-model operations; preserve the established small-state and targeted context-update pattern rather than creating another file-history subsystem.

File state stores `replacementMessageId`, `discoveredDependencyDesigns` and `messagesSinceRefresh`, alongside the existing per-file `visibleMessageId` registry. `lastObservedMessageCount` is an internal cursor on Agent's cumulative append clock; it avoids counting by scanning the transcript. Agent indexes pending user inputs and context entries by ID. Refresh looks up only tracked active file messages and the previous replacement. Visibility metadata, the new context-only message and the small state snapshot acknowledge in one transaction. Reset clears them together. Compaction may remove referenced entries; missing IDs are skipped, without history reconstruction. A saved replacement-message ID alone does not establish that a current generated instruction exists: the referenced entry must still be present and visible in retained context.

#### Checkpoint and insertion conditions

The only check-and-replace checkpoint is reaction to incoming real user input after the previous run has ended, before the next ordinary model call. At that checkpoint, insert one generated instruction when either condition is true:

1. No current generated-instruction entry exists in the Agent's retained model context.
2. At least 64 completed messages have accumulated since the last successful insertion or refresh.

These are independent conditions; the missing-instruction condition supplements, and does not remove or replace, the 64-message threshold. If both hold, perform one insertion/refresh, not two. If neither holds, preserve the current generated instruction and dependency-context visibility.

Initialization and explicit reset do not insert a message by themselves. Their first subsequent real user-input reaction supplies the instruction when none exists. Successful compaction prepares and publishes matching context/Harness state but does not check for or insert this instruction itself. Its next real user-input reaction applies the same two conditions. Ordinary backend restart with a retained current instruction does not cause a duplicate.

No dependency-context check or replacement occurs during a run, on assistant/tool responses, inside compaction or automatically when a run finishes. The agent may reveal dependency implementation and context throughout its run; reaching the threshold does not replace that information immediately.

The threshold is **64 completed messages** added to the member's context since its last successful refresh. Count incoming messages, assistant messages and tool-result messages once each; include the triggering incoming user message once when checking the boundary. Streaming chunks are not separate messages. Do not count system prompts or the refresh's own automatically inserted context message. Do not weight messages by length/tokens or count each model request's repeated context. This threshold is separate from model-call limits and token-based compaction.

Below 64, insert only when no current generated instruction exists; otherwise leave dependency-context visibility unchanged. At or above 64, perform one refresh at that checkpoint even when an instruction is already present. Either successful insertion or refresh resets the count only after its atomic message/state acknowledgement. A failed insertion or refresh must not advance the successful-refresh marker or claim its counter reset. The generated instruction must not recursively trigger another user-input refresh.

#### New replacement context

Construct one private replacement message containing the current full design-system tree and the usage README context of every accumulated discovered dependency.

The tree is for overall project orientation and follows the project hierarchy. Structural nodes connect that hierarchy. For a node explicitly bound to a design part, append only its optional existing summary text; leave absent summaries absent. Do not inherit a parent's design binding onto other nodes or generate descriptions with another model. Mark the member's assigned working designs, including their covered descendants, with `[working]`. Do not add extra node metadata such as IDs, hashes, revisions, document-path fields or discovery status.

Use the agent-facing term **usage README context**. For every discovered dependency, insert its current README content once. Do not expand README include references or expose their files' contents automatically; those references can remain ordinary README text and the agent can inspect files independently. If a README is missing, state `No README available.` for that dependency. Do not fabricate a contract, substitute DESIGN/internal notes or retain hidden raw context as an implicit missing-README exception.

#### Hide and preserve

At successful refresh, hide the following from effective model context:

1. The previous replacement-context message.
2. Revealed source-file context belonging to design systems outside the working designs.
3. Revealed RSI context belonging to dependency design systems, including DESIGN, README and internal notes. Their refreshed usage README is represented through the new generated message.

Preserve working-design source/context content, ordinary conversation and useful private execution messages. The newly generated message remains visible. Stable history is immutable; hiding is model-facing projection/visibility, not deletion of original stored messages. Preserve every tool call's paired result and provider protocol/signature data. Existing per-file aggregate supersession remains a separate File tool behavior; the dependency-refresh replacement described here happens only at the user-input checkpoint.

#### Generated message role and marker

Deliver the replacement as a native **user-role message**, wrapped with `<system_instruction>` and `</system_instruction>`. The marker identifies its application purpose; it does not turn it into a provider system-role message or insert it into the fixed system prompt. Tell the agent that the system generated it to provide useful information and that it is not a user request. Do not expose the File React Harness name or other implementation ownership details in that message. Keep it private to the receiving Agent; do not publish it as a user/group-chat message.

The intended presentation is:

```text
<system_instruction>
This message is automatically generated by the system to provide
useful context. It is not a user request.

## Design tree

Project
├── frontend/ [working] — User-facing application
│   └── chat/ [working] — Group chat and streamed responses
└── backend/
    ├── storage/ — Database connections and transactions
    └── authentication/ — Identity and authentication

## Usage README context

### backend/storage/
[README content]

### backend/authentication/
No README available.
</system_instruction>
```

Use the actual current tree, summaries, assignments and discovered READMEs. The example is a presentation shape, not new design parts or invented project metadata. Dynamic injection of member identity, responsibility and roster remains a separate future design.
