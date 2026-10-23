> Existing behavior reference inside the aggregate implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

# Design nodes implementation

## Contract

[Design nodes](design.md) resolves metadata-only JSON plus complete Markdown contexts, accepted-state precedence, explicit issues and identity independent of document representation.

## Responsibilities and decomposition

DesignService owns catalog/inspect/read and metadata interpretation. context-documents validates structural file/directory forms, entry order and budgets, used by design reads and context validation. Workspace layout owns node references, reserved content roles and derived paths. ContextBase owns raw files/history; ordinary project Git supplies committed design content with a one-time SQL bootstrap/import baseline. No design table, specialized edit tool or semantic heading parser is added.

## Coordination and data flow

Validate node reference, read metadata through ordinary committed project content or bootstrap/import baseline before raw ContextBase, and gather the node's own design.md/design/ files. Do not gather child systems or impl/ as design. Union raw document listings with committed design paths so unpublished accepted additions and tombstones work. Reject truncated listings and storage problems within design content. resolveDesign parses strict implementation metadata and calls contextDocuments; directory README is first, remaining paths sorted. Return aggregate content and separate actual-source-path documents. Revision hashes lower-case path/revision pairs for all participating files. Current reads span ordinary observations, with no cross-file snapshot transaction guarantee.

Catalog scans metadata candidates from raw and accepted paths, validates each independently, omits unavailable designs and returns truncation. Reserved design/impl parent names prevent nested document metadata from becoming nodes. Missing/invalid source remains inspectable through raw APIs. The former DesignService.save of embedded JSON content is removed; setup/tests seed real metadata/Markdown files through ordinary ContextBase saves.

## Decisions and constraints

One metadata reference survives document representation changes and member replacement. JSON holds mapping only. Prose section correctness is supplied by harness prompts. No legacy JSON/ownership-category fallback is introduced. Accepted per-file tombstones hide removed original documents, enabling single-file/directory transitions without copying snapshots into the original checkout. Multi-file inspection is not a transaction over concurrent edits.

## Code map

- [Semantic catalog](../../../../../../../../../../backend/src/core/design.ts): DesignMetadata, resolveDesign, DesignService list/inspect/read.
- [Document format](../../../../../../../../../../backend/src/core/context-documents.ts): file/directory structural validation and limits.
- [Layout](../../../../../../../../../../backend/src/core/workspace-layout.ts): nodeReference, contextPaths and contextLocation.
- [Ordinary Git utilities](../../../../../../../../../../backend/src/core/workspace-git.ts): committed control-file reads and one-time baseline import.

## Verification

[Catalog tests](../../../../../../../../../../backend/test/design-catalog.test.ts) verify discovery independent of membership, metadata issues and retirement. [Context tree tests](../../../../../../../../../../backend/test/context-tree.test.ts) verify multi-document identity, revision changes, explicit children, missing/ambiguous forms, recursive working-node permissions, acceptance, context transition history and case-sensitive disk spelling. HTTP and disposable MySQL tests cover current inspection, accepted mappings, durable bootstrap/history and rollback.

metadataPath resolves a semantic node reference to its raw design/ metadata path. contextPaths includes the purpose prefix. Catalog summaries keep design-root-relative references; inspect results return raw metadata/document paths for file opening and relative links. Catalog ignores metadata outside design/.

DesignService.working discovers candidate metadata paths under the design root, selects explicit roots and their descendants, and reads their accepted content using one accepted snapshot. Unaccepted pending-only nodes are skipped; invalid accepted descendants and truncated scans refuse. Overlapping roots deduplicate case-insensitively.
