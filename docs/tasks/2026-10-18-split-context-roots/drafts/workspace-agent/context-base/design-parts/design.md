<!-- Task proposal; current contract is under docs/systems/ -->
# Design nodes

## Purpose and boundary

Expose current system designs and accepted implementation mappings, independently of team membership. A system is identified by metadata.json and its complete Markdown design context. Document organization does not define additional systems.

## Inputs and preconditions

A reference is design-root-relative metadata.json (root) or backend/metadata.json (child), optionally prefixed .rsi/context/design/ or design/. Raw metadata lives at design/<reference>, while implementation context follows the matching node under implement/. Context path/name rules apply; node parent names cannot be design/impl content directories or end in .md/.json. Metadata has exactly {implementation: [project paths]}, at most 50 distinct safe paths; . is allowed and protected .rsi/.git paths are refused. It never contains Markdown prose or revision bookkeeping.

Design content uses design.md or design/README.md plus other Markdown documents. Exactly one representation must be present, with 1–100 nonempty documents and at most 1 MiB total. Directories may nest document folders without creating subdesigns. Complete design context includes purpose/responsibilities/boundaries, Interface contract and constraints/specifications/requirements; semantic headings are model instructions rather than parser validation.

## Outputs and observable effects

GET /workspaces/:workspaceId/designs returns {designs: [{path, revision, implementation}], truncated}. Discover metadata nodes, independently of assignments; omit invalid/unavailable designs and report listing truncation. Root and child nodes follow folder hierarchy. No worktree, member or run is created.

GET /workspaces/:workspaceId/designs/file?path=... returns metadata file information plus {design, designIssue}. design contains {implementation, content, documents:[{path,content}]}; content joins ordered Markdown documents, entry first. Raw metadata/document paths include design/ and preserve source spelling for correct relative links. Valid design revision covers metadata and every design document, so document-only changes invalidate it. It is not a raw metadata-file revision for saving. Invalid designs return null design and an issue with inspectable raw metadata; missing metadata returns not_found.

User-accepted harness snapshots overlay original design files, including additions and deletions; pending worktree bytes do not. Semantic reads supply permission mappings. Raw file/history APIs continue observing original files. No semantic save API/tool is exposed: ordinary file tools edit pending Markdown and metadata; user acceptance commits their exact reviewed scope.

## Failure behavior

Unsafe references, invalid/missing metadata, unsafe mappings, absent/empty or ambiguous document representations, unsupported document entries, missing README and exceeded limits fail semantic resolution. Inspection preserves a readable metadata source and issue when possible. Discovery skips unavailable records. Storage/unavailable workspace errors propagate. Current reads/discovery are observations and do not promise a transaction over concurrent multi-file changes.

## Guarantees and limits

Design identity is independent of member identity and file/directory document form. Only an explicit node metadata record with valid design content creates a catalog system; files inside design/ or impl/ do not. Working assignments derive implementation authority from accepted metadata. Dependency mappings remain read-only. An implementation-context path or ordinary Markdown file is not a node reference. Safe unresolved stored assignments grant no authority and remain visible as readiness issues.

## Acceptance examples

1. backend/metadata.json with implementation ["backend/src"] and backend/design.md is one usable system.
2. Replacing design.md with design/README.md and design/flow.md preserves that identity; inspection returns both documents and a changed node revision.
3. backend/impl/metadata.json never creates a subdesign. backend/storage/metadata.json plus storage design does.
4. User acceptance changes mapping from old to new; semantic inspection and harness resolution see new. Pending metadata cannot expand authority.
5. JSON {content,implementation} or design.md together with design/README.md returns an explicit designIssue and grants no authority.
