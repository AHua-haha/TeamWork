## Result summary

Foundation implementation context rebuilt after inspecting all five assigned files. Actual Foundation contains shared runtime values/errors, serialization validation, context-base change notifications, text/file helpers and runtime-tool output helpers. No project source changed. Two accepted design debt items remain visible in code: codec imports `Author`/`ChangeRecord` from Domain, and tool-result imports `RuntimeTool` from Domain. `types.ts` currently defines `ProgressEvent` locally, so the design's `ProgressEvent` type cycle is resolved in this realization. `changes.ts` is dependency-free.

## File lookup

| Path | Description |
|---|---|
| `backend/src/foundation/types.ts` | AppError, run/context/follow shapes, ID and position validators. |
| `backend/src/foundation/codec.ts` | JSON envelope serialization and strict Pi/run/author/change validation. |
| `backend/src/foundation/changes.ts` | Versioned in-process wait/publish notification. |
| `backend/src/foundation/text.ts` | UTF-8/text validation, SHA-256 and missing-file utility. |
| `backend/src/foundation/tool-result.ts` | `ToolOutput` alias and `toolText` constructor. |
| `.rsi/context/design/backend/foundation/design.md` | Accepted Foundation design and stated dependency constraints. |

## Implemented contract

### Values and validators (`types.ts`)

`AppError(code, message, status=400)` is an Error carrying transport code/status. `ContextEntry` has messageId, Pi `Message`, JSON-object metadata; `ContextHistory` adds revision. `CompletedMessage` adds agentId/runId/position. Run and follow types model persisted run state and version-2 events, including message, sync, compact chunk, gap, state and end. `identity(value,label='identity')` asserts 1–64 ASCII alphanumeric/underscore/hyphen string, otherwise throws `invalid_input`. `position(value)` asserts a nonnegative safe integer. These validators have no side effects. Example: `identity(id, 'agentId'); position(cursor);`.

### Codec (`codec.ts`)

`encode(value)` accepts JSON-compatible values and returns JSON string `{version:1,data:value}`; rejects unsupported prototypes, symbols, cycles, nonfinite numbers and non-JSON values. Undefined object values are omitted under JSON serialization. `decode<T>(raw, validate)` accepts string or parsed envelope, validates version/data and callback, returns typed data; any error becomes `AppError('corrupt_data', ..., 500)`. `validateMessage`, `validateEntries`, `validateRun`, `validateAuthor`, `validateChangeRecord` enforce corresponding Pi data/identity/status/change shapes and throw `invalid_data` (the decode wrapper remaps to corrupt_data). Example: `const raw = encode(entries); const restored = decode<ContextEntry[]>(raw, validateEntries);`.

### Changes and text

`Changes.publish()` increments public `version` and wakes all waiters. `wait(version, signal?)` resolves immediately if aborted or version already differs; otherwise waits until publish/abort, removing its listener. It is an in-memory notification only, not durable. `decodeText(Uint8Array)` returns exact valid UTF-8 text (including BOM) or null for invalid UTF-8/NUL. `encodeText(string)` rejects NUL/unpaired surrogates and payloads over 1 MiB (413), returns Buffer. `sha256(bytes|string)` returns lowercase hex digest. `missing(error)` returns true for ENOENT/ENOTDIR. `toolText(text)` returns `{content:[{type:'text',text}],isError:false}` as RuntimeTool output; `ToolOutput` is inferred from domain RuntimeTool execute.

## Implementation notes

Foundation imports Pi types and Node crypto plus Domain types in codec/tool-result (accepted debt, but conflicts with its intended innermost-layer boundary). `ProgressEvent` is `Exclude<AssistantMessageFrame, {type:'start'}>` plus a start carrying full `AssistantMessage`. Codec supports known text/thinking/image/toolCall blocks and validates assistant usage/cost fields; unknown blocks fail explicitly. `text.ts` max file size is 1 MiB.

## Verification and continuation

Inspected all assigned Foundation source files and accepted design. No tests run; source untouched. Dependency inversion debt should be reported to lead; do not alter Domain or Foundation contracts silently. Check codec against pinned Pi 0.87.1 and add tests only in a separately authorized code task.

## Automatic retrieval

```json
{"commands": []}
```
