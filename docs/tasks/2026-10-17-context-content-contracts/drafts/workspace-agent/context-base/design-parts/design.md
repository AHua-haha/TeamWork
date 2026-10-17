<!-- Task proposal; current contract is under docs/systems/ -->
# Design parts

## Purpose and boundary

A design part is the user's design for a project or one of its parts. It holds design content and the corresponding implementation files or directories together. The lead helps the user maintain it through pending harness copies. Accepted design mappings determine harness implementation authority. The semantic design view reads user-accepted harness snapshots first and original context for paths without such acceptance.

## Inputs and preconditions

A design part is a user-context text file whose JSON object is {content: "Markdown text", implementation: [project paths]}. Paths are workspace-relative files or folders; "." names the project root. .git, .rsi/context and .rsi are excluded. At most 50 distinct implementation paths are allowed. Existing context path and size rules apply. Files can be arranged hierarchically and content can refer to other subdesigns.

### Current discovery for frontend callers

`GET /workspaces/:workspaceId/designs` returns `{designs, truncated}`. Each summary is `{path, revision, implementation}` for a valid current user-context design. Ordinary notes and invalid design records are omitted. Discovery is independent of current team membership, lists paths in order, and combines the original context tree (at most 2,000 entries at depth 16, with explicit truncation) with paths retained by accepted harness design references.

`GET /workspaces/:workspaceId/designs/file?path=...` returns the current raw context file plus `{design, designIssue}`. Valid records return their parsed content/mapping; invalid records return null design and a reason, allowing a referenced malformed design to be explained. Missing paths and unavailable storage/folders retain the existing context failure behavior. These operations are read-only, do not start agents, and do not return earlier versions. Discovery and individual reads are current observations rather than a transaction spanning concurrent edits.

## Outputs and observable effects

Reads return the design part, its path, revision, and implementation mapping. A backend attributed save replaces content and mapping as one versioned original-context save. Members edit pending copies through common harness file tools, with explicit user acceptance required for their design commits; accepted harness snapshots become authoritative in this semantic view. Original-context edits retain their usual revision protection but do not supersede an existing harness acceptance pointer. Raw context file/history endpoints continue to show original-workspace records.

## Failure behavior

Missing design files, invalid JSON/schema, or invalid implementation paths fail explicitly. A harness cannot resolve invalid design metadata. Original-context inspection exposes malformed raw files and revisions; common harness file tools can repair pending copies for user review.

## Guarantees and limits

Design identity is its context file, independent of member identity. Implementation paths may name files that will be created later. Reading a design does not create a member or change the design. Content and mapping are saved together; changes to mapping are design changes made known to the user. Design Markdown is instructed to contain purpose/responsibilities/boundaries, Interface contract, and constraints/specifications/requirements. Exact signatures/routes/schemas can be settled in the implementation context’s Implemented contract. There is no new semantic-heading validator or automatic knowledge consolidation.

## Acceptance examples

1. user/design/backend.json holds the backend design and implementation ["backend/src", "backend/test"]. A member can edit those implementation paths when that working design is assigned to it; no separate implementation path assignment is required.
2. A dependency references user/design/api.json, whose implementation is ["shared/api.ts"]. The member can read the dependency design. Its dependency mapping grants read access to shared/api.ts and no write access.
3. A mapping changes after a user discussion. The next design read shows the resulting mapping, and subsequent harness resolution uses the accepted mapping. Pending member-worktree edits do not affect it. Member configuration activation is a separate user-controlled workspace-idle operation.

A user-approved harness design snapshot is visible through semantic read/discovery, including newly created designs and accepted deletions. It is not copied into the original checkout or existing peer worktrees; original-context file/history review remains a separate existing surface. Semantic reads and mappings ignore pending worktree bytes.

Each design file user/<path> pairs with implementation context agent/<lower-cased-path>.md, retaining its full extension. Pairing and scope authority are backend-derived; no JSON field is added. The implementation context’s Input, Output, Effect and Usage examples describe actual implemented interfaces. Existing JSON parsing and discovery remain unchanged.
