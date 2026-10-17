# Context contract perspective and system boundaries

Status: complete
Task start commit: fb2a0e8d35179e7cc033e65323ce6c116e20de5b
Review boundaries: [Context content model](drafts/workspace-agent/context-base/design.md)

## Design outcomes

- [delivered] Both Interface contract and Implemented contract explain what the same system provides and how callers use it; design states intent, implementation gives actual precise usage.
- [delivered] Multiple documents within design/ or impl/ retain that one system boundary. A child system defines its own purpose and caller-facing contracts at a distinct boundary.

## Decisions and open questions

The user clarified the intended mental model. Internal implementation notes remain useful supporting context, while the Implemented contract is caller-facing. Decomposition is not implied by document splitting. A subsystem caller can be its parent or a sibling system. The parent contract remains sufficient for its own callers. No schema, permissions, storage paths, API or runtime algorithm changes are needed.

## Checkpoints and remaining work

Updated base harness rules, bootstrap Markdown templates and canonical context guidance together. Verification recorded in [tests.jsonl](tests.jsonl): focused implementation-context/bootstrap tests, backend build, packaged instruction/template checks and promoted-document audit. Existing workspace content is not rewritten; permissions, schema and runtime logic are unchanged. Unrelated local files are preserved. No remaining design decision or implementation work in this clarification.
