> Proposed for 2026-10-24-business-data-models; delivered with source.

# Workspace

## Purpose, responsibilities and boundaries

Own workspace registration/creation, project directory/configuration, workspace model choices, design tree and design/implementation context documents, file indexing/history and project file access. Team owns member/chat/configuration records; Agent owns execution/context/history persistence. Workspace aggregates its core in-memory schema, durable model and related data operations in its own data-model part.

## Interface contract

Create/adopt/list/read workspaces; manage workspace-owned settings, design/context files, accepted mappings and file review. Core coordinates initial lead creation atomically with registration through Team. Preserve paths, revisions, accepted recursive working scopes and context history. Own workspace/context/models/baseline public records, file state, validation and management interfaces. Workspace’s own data-model part implements registry/context/model/baseline persistence. Core supplies public Team callbacks for atomic lead/bootstrap and default initialization; Workspace does not interpret or write Team/Agent SQL records. Reusable context/file services may accept Workspace’s own persistence port.

## Constraints, specifications and requirements

Preserve existing public HTTP/SSE payloads, stable SQL/JSON formats, ordering, authority and lifecycle behavior. Workspace owns both its core in-memory model and durable representation, schema, mapping, validation, queries and related operations. Technical Storage supplies engine resources only. Share explicit interface values and lifecycle notifications; keep private runtime state and SQL schemas inside their respective owners. Filesystem/tool effects can precede failures and are never automatically replayed.
