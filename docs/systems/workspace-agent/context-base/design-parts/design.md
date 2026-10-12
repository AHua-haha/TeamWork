# Design parts

## Purpose and boundary

A design part is the user's design for a project or one of its parts. It holds design content and the corresponding implementation files or directories together. The lead helps the user maintain it; the harness uses it to derive file permissions.

## Inputs and preconditions

A design part is a user-context text file whose JSON object is {content: "Markdown text", implementation: [project paths]}. Paths are workspace-relative files or folders; "." names the project root. .git and .context are excluded. At most 50 distinct implementation paths are allowed. Existing context path and size rules apply. Files can be arranged hierarchically and content can refer to other subdesigns.

### Current discovery for frontend callers

`GET /workspaces/:workspaceId/designs` returns `{designs, truncated}`. Each summary is `{path, revision, implementation}` for a valid current user-context design. Ordinary notes and invalid design records are omitted. Discovery is independent of current team membership, lists paths in order, and examines at most the context tree's 2,000 entries at depth 16; truncation is explicit.

`GET /workspaces/:workspaceId/designs/file?path=...` returns the current raw context file plus `{design, designIssue}`. Valid records return their parsed content/mapping; invalid records return null design and a reason, allowing a referenced malformed design to be explained. Missing paths and unavailable storage/folders retain the existing context failure behavior. These operations are read-only, do not start agents, and do not return earlier versions. Discovery and individual reads are current observations rather than a transaction spanning concurrent edits.

## Outputs and observable effects

Reads return the design part, its path, revision, and implementation mapping. A lead save replaces content and mapping as one versioned context save, with the reason and exact previous/resulting file content visible in its tool record. User edits through the context API retain their usual revision protection.

## Failure behavior

Missing design files, invalid JSON/schema, or invalid implementation paths fail explicitly. A harness cannot resolve invalid design metadata. The lead's read tool also exposes raw file content and its revision so that it can repair an invalid record after discussion with the user.

## Guarantees and limits

Design identity is its context file, independent of member identity. Implementation paths may name files that will be created later. Reading a design does not create a member or change the design. Content and mapping are saved together; changes to mapping are design changes made known to the user. No fixed semantic design schema or automatic knowledge consolidation is introduced.

## Acceptance examples

1. user/design/backend.json holds the backend design and implementation ["backend/src", "backend/test"]. A working assignment can edit those paths.
2. A dependency references user/design/api.json, whose implementation is ["shared/api.ts"]. The member can read the design and shared/api.ts and cannot edit either through file tools.
3. A mapping changes after a user discussion. The next model call and file action use the resulting mapping.
