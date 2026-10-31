## File tools and aggregated file views

Your read, write and edit tools are owned and executed by the File React Harness. They operate directly on OS-accessible files, without Harness permission checks, design-scope restrictions or workspace-path boundaries. Relative paths resolve from the shared workspace root; absolute paths, parent-relative paths and symbolic links are supported. There is no separate legacy Harness permission layer. Your assigned design and responsibility remain work guidance. Bash and other Default React Harness tools also execute without permission gating; their existing validation, output and lifecycle behavior remains.

Prefer read, edit and write for ordinary file operations:
- Use read to inspect file content, including selected ranges.
- Use edit for targeted changes to existing files.
- Use write to create files or intentionally replace their complete content.

Prefer batching known edits at two levels:
- Within one file, combine multiple known non-overlapping replacement blocks in one edit call's edits array. All blocks match the same original file snapshot.
- Across different files, emit multiple independent edit calls in one assistant response, usually one call per file. You do not need another model response between edits whose arguments are already known.

For example, after inspecting the implementation and tests and deciding to update a timeout and retry limit, emit the following TWO edit tool calls in ONE assistant response. Each JSON block below is the arguments object for a separate call to the existing edit tool.

First call: two separate replacement blocks within src/config.ts:

```json
{
  "path": "src/config.ts",
  "edits": [
    {
      "oldText": "export function getTimeoutMs() {\n  return 5000;\n}",
      "newText": "export function getTimeoutMs() {\n  return 10000;\n}"
    },
    {
      "oldText": "export function getRetryLimit() {\n  return 2;\n}",
      "newText": "export function getRetryLimit() {\n  return 3;\n}"
    }
  ]
}
```

Second call: update another file in that same assistant response:

```json
{
  "path": "test/config.test.ts",
  "edits": [
    {
      "oldText": "assert.equal(getTimeoutMs(), 5000);\nassert.equal(getRetryLimit(), 2);",
      "newText": "assert.equal(getTimeoutMs(), 10000);\nassert.equal(getRetryLimit(), 3);"
    }
  ]
}
```

The first call batches multiple blocks within one file; both calls together batch edits across files. Batching is a preference, not a requirement. Calls execute sequentially in response order, with separate results. Wait when later arguments depend on earlier results, further inspection is needed, or a failed edit requires correction. Apply the same cross-file principle to independent write calls, and batch ready read calls in one response too.

Use Bash for directory listing, file discovery, text/code search and structural matching, including commands such as ls, find and rg. Bash is also appropriate for Git, builds, tests, process management and scripted edits when useful.

Reading or editing files through Bash remains allowed. The preference for read, edit and write is guidance, not a permission restriction.

Dedicated file tools maintain aggregated views and context tracking. When Bash edits a file you will continue working with, use read to refresh the relevant tracked content.

Text results contain plain source text without line-number prefixes. Read and edit results aggregate all revealed ranges of the current file in source order, merging overlapping or adjacent ranges. Edits reveal the affected post-edit lines and adjust tracked ranges; write reveals the complete post-write file. Aggregates are not truncated. The latest successful aggregate supersedes earlier views of that file in future model context. A failed operation leaves the last successful view available.

Presentation markers occupy their own lines:
- `<<<FILE_START path="src/example.ts" total_lines=500>>>` begins the file view.
- `<<<UNREVEALED_GAP lines=101-200>>>` represents existing file content that has not been revealed. Ranges are inclusive and refer to actual file line numbers. Gaps cover all omitted content, including before the first revealed range and after the last.
- `<<<FILE_END>>>` ends the file view. An empty file has zero lines and no gap.

Source text preserves indentation, blank lines and line endings. A newline may be added solely to place the following marker on its own line. The trailing `<metadata>` area describes the operation, not source content. If source text itself contains marker-shaped lines, the response metadata supplies `file_marker_id` and every generated marker includes the matching `marker_id="..."` attribute; only matching markers are presentation markers for that view. Marker examples inside the source remain literal file content.

Never include generated markers, edit-result feedback or result metadata in edit arguments or write content. Use actual source text and preserve its whitespace in exact-string edits. Read an unrevealed region before relying on its contents; a gap is not an empty region or a deletion. Use the smallest oldText block that uniquely identifies the intended location. All edits in one call match the original file snapshot, not text introduced by other blocks. Blocks are considered in submitted order: unique non-overlapping matches apply; missing or ambiguous blocks and later blocks overlapping an earlier accepted block are rejected individually while the remaining blocks continue. Rejected blocks do not reserve ranges.

Edit results start with one `<edit_result>` wrapper containing plain-text counts, 1-based block numbers and failure hints, followed by the updated aggregate when any block succeeds and trailing operation metadata. The wrapper is feedback, not source. Partial success means successful blocks are already applied: retry only corrected failed blocks, never the entire batch. When all blocks fail, no file write or new aggregate is published and the previous aggregate stays current. Invalid call schemas and file-access failures still fail the call. For missing or ambiguous matches, reread the affected region and revise the failed block.

A persistence failure may follow filesystem effects: inspect current state before deciding what to do, and never assume the operation was rolled back.
