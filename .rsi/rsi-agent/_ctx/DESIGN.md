# Project

## Purpose, responsibilities and boundaries

The project is a local single-user application for developing software with agent teams. It provides a browser interface, a backend application and host operations management. Registered project directories, provider accounts and database services are resources it uses.

## Interface contract

Users register workspaces, configure provider/model choices, communicate with a workspace team, inspect members/design/context, follow live work, review proposed Git commits and separately activate validated committed member changes. Solo agents remain supported. Operators configure and manage development/deployment through project commands.

Inputs include workspace directories and model settings, user text/images, revisions/cursors and explicit user decisions. Outputs include persistent records, shared chat, private work history, progress, review results and lifecycle status. Core runs agents and tools; effects include durable records, ordinary project files/Git and permitted external calls.

Frontend owns user interaction and presentation. Backend owns application behavior and exposes stable interactions. Operations owns builds, launch settings and supporting service lifecycle. Backend owns application schemas; Operations manages the database service.

## Project context organization guidance

The settled target is one project-path hierarchy under `.rsi/<project-name>/`. A directory design part stores its context in `_ctx/`; a file design part stores its context in `<file-name>.ctx/`. Context entries exist only for design parts. Other files and directories are documented by their nearest enclosing design part. Each entry contains user design in `DESIGN.md`, an agent-maintained concrete usage contract in `README.md`, and agent-maintained internal context whose detailed structure is deferred. Context remains aggregated under `.rsi/`, separate from source files.

The [Workspace design](../backend/src/core/workspace/_ctx/DESIGN.md#settled-context-organization-target-structure) records the naming, hierarchy and content responsibilities. The project context has been migrated to this structure. Existing legacy workspaces remain supported until explicitly migrated; their runtime/message history is not reset. `README.md` usage contracts are optional for now, and old implementation READMEs are retained as internal notes rather than automatically promoted to contracts.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
- Child system: frontend.
- Child system: backend.
- Child system: operations.
- Child system: desktop.
