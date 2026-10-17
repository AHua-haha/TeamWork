# Design nodes implementation

## Contract

[Design nodes](design.md) resolves metadata-only JSON plus complete Markdown contexts, accepted-state precedence, explicit issues and identity independent of document representation.

## Responsibilities and decomposition

DesignService owns catalog/inspect/read and metadata interpretation. context-documents validates structural file/directory forms, entry order and budgets, shared with implementation-context commits. Workspace layout owns node references, reserved content roles and derived paths. ContextBase owns raw files/history; HarnessHistory owns accepted per-file pointers. No design table, specialized edit tool or semantic heading parser is added.

## Coordination and data flow

Validate node reference, read metadata through accepted Git pointers before raw ContextBase, and gather the node's own design.md/design/ files. Do not gather child systems or impl/ as design. Union raw document listings with accepted Git paths so unpublished accepted additions and tombstones work. Reject truncated listings and storage problems within design content. resolveDesign parses strict implementation metadata and calls contextDocuments; directory README is first, remaining paths sorted. Return aggregate content and separate actual-source-path documents. Revision hashes lower-case path/revision pairs for all participating files. Current reads span ordinary observations, with no cross-file snapshot transaction guarantee.

Catalog scans metadata candidates from raw and accepted paths, validates each independently, omits unavailable designs and returns truncation. Reserved design/impl parent names prevent nested document metadata from becoming nodes. Missing/invalid source remains inspectable through raw APIs. The former DesignService.save of embedded JSON content is removed; setup/tests seed real metadata/Markdown files through ordinary ContextBase saves.

## Decisions and constraints

One metadata reference survives document representation changes and member replacement. JSON holds mapping only. Prose section correctness is supplied by harness prompts. No legacy JSON/ownership-category fallback is introduced. Accepted per-file tombstones hide removed original documents, enabling single-file/directory transitions without copying snapshots into the original checkout. Multi-file inspection is not a transaction over concurrent edits.

## Code map

- [Semantic catalog](../../../../../backend/src/design.ts): DesignMetadata, resolveDesign, DesignService list/inspect/read.
- [Document format](../../../../../backend/src/context-documents.ts): file/directory structural validation and limits.
- [Layout](../../../../../backend/src/workspace-layout.ts): nodeReference, contextPaths and contextLocation.
- [Harness history](../../../../../backend/src/harness-history.ts): accepted file pointers and immutable scope snapshots.

## Verification

[Catalog tests](../../../../../backend/test/design-catalog.test.ts) verify discovery independent of membership, metadata issues and retirement. [Context tree tests](../../../../../backend/test/context-tree.test.ts) verify multi-document identity, revision changes, explicit children, missing/ambiguous forms, exact-node permissions, acceptance, context transition history and case-sensitive disk spelling. HTTP and disposable MySQL tests cover current inspection, accepted mappings, durable bootstrap/history and rollback.
