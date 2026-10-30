# React Harness implementation context

## Result summary

Core React Harness is a sibling of Agent. All purpose implementations, integration contracts, tools, instructions and resident instance management live under `backend/src/core/react-harness`. It directly uses Agent data-model operations for context and durable acknowledgement.

## Implemented contract

**Input:** ReactHarness / ReactHarnessFactory / ReactHarnessTool from index.ts. `handle(response, {scope,toolCalls,validateToolCall,beforeToolCall,execute,data})` receives actual `AgentTurnData` as data. It provides messages/entry/recordToolResult/updateMetadata/appendInstruction operations. There are no runtime-specific contextEntry, recordToolResult, appendHint, updateMetadata or argument-suppression proxy callbacks on the context object. Tools and execution metadata use public Agent data/execution types. Purpose projections receive detached context entries.

**Output/effect:** File owns read/write/edit, aggregate views, visibility/write-argument metadata and projection. It builds generic ComponentMessageEffects and calls data.recordToolResult, with its next small state applied only after acknowledgement. Default owns native search, persistent Bash, web tools and unclaimed configured executors. The runtime preserves call ordering; the data model records paired results once and flushes private instructions only after all results. Registry restores/reuses instances using AgentData.getComponentState/saveComponentState directly. Persistence failure invalidates residency; external effects are never replayed.

**Persistence:** state key `file-content`, physical SQL table agent_assistant_response_handler_state, column handler_id, native message bodies and signatures remain intact. Logical persistence APIs use generic ComponentState/ComponentMessageEffects and componentId because Agent data knows opaque related state rather than file-specific rules. Atomic result/context/state writes remain Agent data operations. Preparation context metadata is separately journaled; no ordinary-context edit occurs before cutover/recovery. No database migration or reset is required.

**Usage:** Team registers fileReactHarnessFactory(root) and defaultReactHarnessFactory(root, extras, guidance) from the public index. AgentRuntime constructs ReactHarnessRegistry with its AgentData model; AgentExecution creates AgentMessageData and a per-response AgentTurnData. A React Harness can call data.entry(id), data.updateMetadata(updates), data.appendInstruction(nativeMessage, metadata), or data.recordToolResult(call, output, metadata, {messageId,effects}). Generic tool execution/ordering still uses the runtime-supplied execute/beforeToolCall functions.

## File lookup

- index.ts and contracts.ts: public integration.
- file/harness.ts and file/context.ts: file tools, aggregation and context projection.
- file/instructions.md: file format/maintenance instructions.
- default/harness.ts and default/tools.ts: default capability assembly and fallback.
- default/bash.ts, bash-model.ts, shell-environment.ts: persistent Bash lifecycle, schema/limits, child environment.
- default/web-tools.ts and tool-result.ts: search/fetch and readable results.
- default/prompts.ts and default/prompts/: instructions and timeout hints.
- data/registry.ts and data/resident-harnesses.ts: reusable instances, state restoration and invalidation.
- Agent data/messages.ts, data/execution.ts, data/repository.ts: public data-model dependencies and atomic persistence.

## Automatic retrieval

```json
{"commands": []}
```

### File tool contract

`read({path,offset?,limit?})` reveals lines (1-indexed); write({path,content}) replaces text; edit({path,edits:[{oldText,newText}]}) applies unique exact-string replacements against one original snapshot. Inputs accept absolute, parent-relative and linked OS-accessible paths. Images remain native prepared image blocks. Text output contains plain source with FILE_START/FILE_END and UNREVEALED_GAP markers covering all omitted ranges, followed by metadata. Source whitespace/line endings are preserved; generated marker collisions use an identified variant.

Each successful result updates small `{files:{canonicalPath:{ranges,visibleMessageId}}}` state, directly targets the previous result's metadata and suppresses successful write arguments in model-facing copies. The original assistant/tool history remains unchanged. The File projection owns visibility/argument rendering. Failed tools retain the last successful view; uncertain persistence invalidates residency and never replays filesystem effects.

The public Agent data entry is `core/agent/data/index.ts`. React Harness imports data models/operations there, not Agent execution/runtime contracts. Agent runtime retains its public API and generic observer-based in-memory hosting while data-owned acknowledgement operations provide persistence.

Verification: all 259 backend unit/HTTP tests and all 98 disposable-MySQL integration tests passed. Both production builds and compiled runtime/prompt loading passed. Tests cover direct data acknowledgement/rollback, paired result ordering and private instructions, ordinary versus preparation metadata, journal recovery, resident state restart, file aggregation and immutable stable history. The filesystem watcher test passed on the final run. No application database reset or deployment was performed.
