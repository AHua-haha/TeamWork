# Workspace agent

## Purpose, responsibilities and boundaries

A **workspace** is one registered project: a directory on the backend's machine, its design/implementation context base, and its team. This system is the unit that gives a project an agent team: it registers and describes the project, gives its agents file access inside the directory, stores the project's design and implementation context with full version history, and hosts the team that plans and implements the work.

It owns the registry and the project-file API, the context-base tree and its versions/change records, and the team with its shared chat and per-member working context. It does not own the agent model loop (the runtime does), model/provider configuration (config does), the user's own project source and Git history (the project's version control does), or the user's acceptance of design/member changes (a user operation).

## Interface contract

**Purpose and supported interactions.** A caller registers a project by absolute directory path, either creating an empty project or adopting an existing one; from then on the caller can browse and edit the project's ordinary files, browse and edit its design/metadata files with history, and converse with its team. A team member additionally receives scoped file tools inside the same directory, its own implementation context, and a maintained working conversation.

**Required inputs and returned information.** Registration supplies a name, an absolute directory, a create/adopt choice and the workspace model choices with a default; it returns the workspace with its context overview and a ready lead. Reads return the workspace list, project file trees/contents, context-base documents/versions/change records, the design catalog with implementation mappings, the active member roster with readiness and harness scope, and the group timeline. Writes are guarded by the previously read revision.

**Observable effects.** A new workspace creates `.rsi/context/design`, `.rsi/context/implement` and `.rsi/members` together with its first design and implementation-context documents and the lead's exact source files, then registers itself, its models, its lead, its member-activation baseline and its initial context change (sequence 1) atomically. Every later context edit becomes an immutable file version plus one ordered change record. Team messages, runs, member records and shared images are persisted in SQL; project files are not duplicated there.

**Failure behavior and lifecycle.** An invalid or overlapping directory, an existing `.rsi` entry on adopt, a stale revision or a busy member refuses the whole operation and leaves nothing half-written; a failed bootstrap removes only what that attempt created. A missing project directory reports the workspace as unavailable until it returns. Workspaces survive restarts. Renaming or removing a workspace is not supported in this version.

## Constraints, specifications and requirements

- Workspace IDs are 1–64 ASCII letters/digits/underscore/hyphen; the backend assigns one when omitted. Names are 1–200 characters without control characters. Directories are absolute, at most 1,024 characters, resolved to their real path, never shared or nested between workspaces (compared without letter case).
- `.git` is always hidden; `.rsi` is hidden from the project-file API and is reached through the context and member systems instead. No operation follows a symbolic link out of the workspace.
- Text content is UTF-8 without NUL, at most 1 MiB, with SHA-256 file revisions.
- Design/metadata files are writable by the user and the lead; implementation context is written by the member that owns it and is read-only through the raw user file API.
- Member change acceptance, activation and conversation reset are explicit user operations performed while the whole team is idle; agents never activate their own changes.
- Project file operations list, read, save and find only: no move, delete, history or live update, and no ignore rules beyond hidden folders.

## Subsystems

- [Workspace](workspace/design.md) — registration, project-file HTTP API, agent file actions, workspace models and fresh bootstrap.
- [Context base](context-base/design.md) — the design and implementation context tree, file versions, change records, the change feed and design-node discovery.
- [Team](team/design.md) — member lifecycle, model settings, activation, inspection, work routing, and the team's shared [group chat](team/group-chat/design.md) and [conversation context](team/conversation-context/design.md).
