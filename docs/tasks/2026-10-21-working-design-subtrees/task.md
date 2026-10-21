# Recursive working-design assignments

Status: complete
Task start commit: efd394dca43b2acd6acef1a3c26e0b3d2e2d8278
Review boundary: [Harness](drafts/workspace-agent/harness/design.md).

## Design outcomes

- delivered: each configured working design includes all accepted descendant design nodes recursively, with their design context, implementation context and mapped source paths.
- delivered: use the same effective scope for runtime prompts, file-tool authority, member inspection, configuration validation and member-context retrieval; preserve configured references.

## Decisions and open questions

Use the design folder hierarchy. The root covers all accepted designs. Deduplicate overlapping assignments. Dependency references remain explicit and retain read-only precedence. Pending nodes grant no new authority; later accepted descendants apply on subsequent resolution without member activation. Invalid accepted descendants or incomplete scans refuse rather than silently deriving a partial assignment. Existing Bash policy remains unchanged. No unresolved decisions.

## Checkpoints and remaining work

Implemented DesignService working-subtree resolution with one accepted design snapshot per expansion. The same resolver supplies file authority, base resources/prompts, member inspection, configuration-validation revisions and member README/retrieval loading. Stored assignments and the frontend API shape are unchanged. Updated maintenance prompts and nine canonical documents with matching task drafts.

Verification: all 183 backend tests and all 65 disposable-MySQL integration tests passed. Backend compilation/build passed. Six new subtree tests cover recursive descendants, root inheritance, case preservation, overlapping-root deduplication, sibling exclusion, unchanged configured references, pending-to-accepted extension, exact dependencies/read-only overlap, invalid descendants, truncated discovery and README/retrieval loading. Existing context/lead tests now expect inherited child authority. Earlier failed checks and subsequent corrections are retained in [test evidence](tests.jsonl).

No remaining implementation work. Existing unrelated untracked local files are preserved. Live deployment and workspace data were not changed; restart the backend or update deployment to load this version.
