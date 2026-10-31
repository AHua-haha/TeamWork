# Project

## Purpose, responsibilities and boundaries

The project is a local single-user application for developing software with agent teams. It provides a browser interface, a backend application and host operations management. Registered project directories, provider accounts and database services are resources it uses.

## Interface contract

Users register workspaces, configure provider/model choices, communicate with a workspace team, inspect active members/context, follow live work and activate validated current member files independently of project Git. Solo agents remain supported. Operators configure and manage development/deployment through project commands.

Inputs include workspace directories and model settings, user text/images, revisions/cursors and explicit user decisions. Outputs include persistent records, shared chat, private work history, progress, review results and lifecycle status. Core runs agents and tools; effects include durable records, ordinary project files/Git and permitted external calls.

Frontend owns user interaction and presentation. Backend owns application behavior and exposes stable interactions. Operations owns builds, launch settings and supporting service lifecycle. Backend owns application schemas; Operations manages the database service.

## Project context organization guidance

The settled target is one project-path hierarchy under `.rsi/<project-name>/`. A directory design part stores its context in `_ctx/`; a file design part stores its context in `<file-name>.ctx/`. Context entries exist only for design parts. Other files and directories are documented by their nearest enclosing design part. Each entry contains user design in `DESIGN.md`, optional consumer context entered through `README.md`, and agent-maintained internal context whose detailed structure is deferred. README clearly describes the actual usage contract; included source files or directories supplement it without a public-interface-only restriction. Context remains aggregated under `.rsi/`, separate from source files.

The [Workspace design](../backend/src/core/workspace/_ctx/DESIGN.md#settled-context-organization) records the naming, hierarchy and content responsibilities. The project context has been migrated to this structure. The old context base and SQL file-history subsystem are removed. Old `.rsi/context/` layouts are unsupported without automatically migrating or deleting their files; workspace and message data are not reset. `README.md` usage contracts are optional for now, and old implementation READMEs are retained as internal notes rather than automatically promoted to contracts.

The context-base manager uses the filesystem as its sole current-state authority and disposable memory holding metadata/references only. Consumers explicitly refresh the source tree and its design-system bindings, for example at agent activation; there is no watcher or automatic live synchronization. Only nodes with their own design system have a binding. A context README's front matter provides `summary` and `include`; included files/directories are project-root-relative and directories expand recursively. README and included source contents are loaded on demand as consumer context. The [manager and format agreement](../backend/src/core/workspace/_ctx/DESIGN.md#context-base-manager-authority-and-lifecycle) defines this implemented filesystem-only behavior.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
- Child system: frontend.
- Child system: backend.
- Child system: operations.
- Child system: desktop.

Project Git is operated directly by agents and users. The backend maintains no additional Git state, accepted-file baseline or Git-dependent member activation. Member configuration activation validates current files and atomically stores the active workspace-team snapshot; configuration-file inspection/history/diff APIs are removed.

Prompt ownership separates fixed instructions from dynamic information. A member uses one agent.md, without catalog or prompt-file selection. Team owns team rules and member information. File React Harness owns file/context maintenance rules and working/dependency context; Default React Harness owns its other tool instructions. Stable rules and agent.md contribute system text. Automatic system-prompt embedding of designs, dependency documents and member identity/responsibility is removed. File-owned dependency refresh is settled below; dynamic member identity/responsibility injection remains deferred.

### User-input context refresh

React Harness reacts to user input and assistant responses. Member configuration retains recursive working-design assignments only; dependencies are discovered through viewed context and accumulate across refreshes and successful compactions. File React Harness checks only at reaction to real user input after prior work stops: it inserts one generated instruction when no current generated-instruction entry exists, and it preserves the existing refresh when the unchanged threshold of 64 completed new context messages is reached. The missing-entry condition supplements the threshold. It never performs this dependency replacement mid-run, inside compaction or solely on run completion.

The refresh privately inserts a native user-role `<system_instruction>` message explaining that the system generated it to provide useful context, not a user request. It contains the full design-system tree, optional node summary text and working-scope markers, then discovered dependencies' usage README context. Included-file contents are not automatically expanded, and missing READMEs are explicitly indicated. Hide the prior replacement and outside-working source/dependency RSI file views in effective model context; preserve working content and immutable history/protocol pairs. Keep discovery and refresh state durable, exclude the generated entry from counting, and reset the count only on success. Detailed responsibilities and presentation are in the React Harness design.
