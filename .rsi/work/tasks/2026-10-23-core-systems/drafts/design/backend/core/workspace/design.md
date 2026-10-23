<!-- Task proposal; promote with implemented and verified source. -->
# Workspace

## Purpose, responsibilities and boundaries

Own workspace registration/creation, project directory/configuration, workspace model choices, design tree and design/implementation context documents, file indexing/history and project file access. Team owns member/chat records and Agent owns in-memory execution; Team maintains its durable history.

## Interface contract

Create/adopt/list/read workspaces; manage workspace-owned settings, design/context files, accepted mappings and file review. Core coordinates initial lead creation atomically with registration through Team. Preserve paths, revisions, accepted recursive working scopes and context history. Own workspace/context/models/baseline public records, file state, validation and management interfaces. An injected persistence contract stores registry records and context change batches; Team provides the current durable implementation. Workspace does not require an SQL dependency or interpret private member/chat/run records.

## Constraints, specifications and requirements

Preserve existing public HTTP/SSE payloads, stable SQL/JSON formats, ordering, authority and lifecycle behavior. In-memory model ownership and durable persistence ownership are separate responsibilities and may belong to different systems. The persistence owner defines its durable representation, schema, mapping, validation and queries using the model owner's public interface. Technical Storage supplies engine resources only. Share explicit interface values and lifecycle notifications; keep private runtime state and SQL schemas inside their respective owners. Filesystem/tool effects can precede failures and are never automatically replayed.
