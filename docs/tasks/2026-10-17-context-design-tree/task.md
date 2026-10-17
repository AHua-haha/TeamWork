# Unified project design context tree

Status: complete
Task start commit: e3783cb527196c85e638bb8d7c70d6161ad5bfae
Review boundaries: [Context tree design](drafts/workspace-agent/context-base/design.md), [Implementation proposal](drafts/workspace-agent/context-base/impl.md)

## Design outcomes

- [delivered] Replace user/agent storage roots with one hierarchy following project designs.
- [delivered] Every node groups its design context and agent-maintained implementation context.
- [delivered] Markdown stores document content; JSON stores metadata only.
- [delivered] Each system supports design.md or design/ and impl.md or impl/. Multiple documents do not require child systems; the whole design context stays complete. Real system decomposition remains a separate choice.

## Decisions and open questions

The four structural requirements are settled by the user. Existing purpose/boundary, Interface contract, requirements and Implemented contract content rules remain. Reusable knowledge stays outside context; members and private harness metadata keep their existing roots.

User clarifications: keep the design complete and do not impose a purpose/interfaces/requirements section-fragment layout. One large system can still have multiple design documents in design/ and multiple implementation documents in impl/, without subdesign systems. Completeness belongs to the whole system design context; each document need not repeat the entire contract. Actual decomposition creates distinct complete subdesign nodes. The previous draft's restriction of every system to a single design.md was an overcorrection and is superseded.

Final conventions: metadata.json, design.md or design/, impl.md or impl/, with README.md as directory entry. Metadata references identify nodes independently of document representation; working assignments cover exact nodes. API/frontend paths are relative to the one context root. Scope/Git rules distinguish design/authority metadata from agent-maintained implementation context, and directory documents remain under the same node authority rather than becoming new assignments.

## Checkpoints and remaining work

One completed candidate replaces the category layout, initializes the three-file root, resolves metadata/Markdown node contracts, enforces independent design/context scope history, and updates Design/Team/Files readers. The 13 completed draft documents are promoted into canonical documents with this implementation. No agreed behavior remains pending.

Verification: 120 backend tests, 62 frontend tests, backend/frontend builds, 45 disposable MySQL integration tests, packaged prompt/scope asset checks, document consistency audit and a browser check of the actual HTTP-backed Design/Team/Files surfaces. Every run, including earlier failures, is recorded in [tests.jsonl](tests.jsonl).

The existing Personal Todo workspace is not rewritten or reset. Its old-layout references require explicit repair/reset before running with the new node format. Restart the backend and frontend to load the new code and prompts. Unrelated .claude/, backend/.DS_Store and backend/prompts/.DS_Store are preserved outside this task commit. No merge or push is included.


## Implementation decisions

Use metadata.json as each node’s reference (root metadata.json, child backend/metadata.json), retaining stable references when documents change form. JSON has exactly implementation: project paths; document content is Markdown only. Each context selects design.md or design/README.md plus other Markdown, independently impl.md or impl/README.md plus other Markdown. Both forms at once are invalid. Reserved content-directory names do not become child nodes. Normal working/dependency assignments cover the selected node only; the lead retains design-tree bootstrap management, with dependency designs read-only. Design Git filters include only metadata/design content, excluding every implementation-context path even in new nodes. Context Git parts cover both file/directory forms for one node and keep one stable scope shape across transitions.

The flat context API uses paths relative to .rsi/context and an aggregate files/bytes overview; there are no synthetic ownership categories. User raw file editing remains available for design/metadata, with implementation context read-only. Design inspection returns separate Markdown documents and aggregate content plus validated metadata and a revision covering all design files. Frontend displays document lists with per-document relative links. Existing old-layout workspace data is not silently rewritten or adapted; it needs a deliberate reset/conversion before assignment in the new tree. No model-loop changes or additional agent tools are required.
