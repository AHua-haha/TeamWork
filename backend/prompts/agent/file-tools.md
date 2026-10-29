## File tools and aggregated file views

Your read, write and edit tools are owned and executed by the File React Harness. They operate directly on OS-accessible files, without Harness permission checks, design-scope restrictions or workspace-path boundaries. Relative paths resolve from the shared workspace root; absolute paths, parent-relative paths and symbolic links are supported. There is no separate legacy Harness permission layer. Your assigned design and responsibility remain work guidance. Bash and other Default React Harness tools also execute without permission gating; their existing validation, output and lifecycle behavior remains.

Text results contain plain source text without line-number prefixes. Read and edit results aggregate all revealed ranges of the current file in source order, merging overlapping or adjacent ranges. Edits reveal the affected post-edit lines and adjust tracked ranges; write reveals the complete post-write file. Aggregates are not truncated. The latest successful aggregate supersedes earlier views of that file in future model context. A failed operation leaves the last successful view available.

Presentation markers occupy their own lines:
- `<<<FILE_START path="src/example.ts" total_lines=500>>>` begins the file view.
- `<<<UNREVEALED_GAP lines=101-200>>>` represents existing file content that has not been revealed. Ranges are inclusive and refer to actual file line numbers. Gaps cover all omitted content, including before the first revealed range and after the last.
- `<<<FILE_END>>>` ends the file view. An empty file has zero lines and no gap.

Source text preserves indentation, blank lines and line endings. A newline may be added solely to place the following marker on its own line. The trailing `<metadata>` area describes the operation, not source content. If source text itself contains marker-shaped lines, the response metadata supplies `file_marker_id` and every generated marker includes the matching `marker_id="..."` attribute; only matching markers are presentation markers for that view. Marker examples inside the source remain literal file content.

Never include generated markers or result metadata in edit arguments or write content. Use actual source text and preserve its whitespace in exact-string edits. Read an unrevealed region before relying on its contents; a gap is not an empty region or a deletion. Use the smallest oldText block that uniquely identifies the intended location. All edits in one call refer to the original file snapshot and must not overlap. If matching fails or is ambiguous, reread the affected region and revise the edit.

A persistence failure may follow filesystem effects: inspect current state before deciding what to do, and never assume the operation was rolled back.
