---
summary: Local single-user software-development workspace with agent teams, solo conversations, persistent history, browser and Electron clients, and isolated host operations.
include:
  - backend/src/runtime/main.ts
  - frontend/src/app/App.tsx
  - frontend/src/app/routes.ts
  - scripts/host-config.mjs
  - rsi.config.example.json
  - .rsi/rsi-agent/_ctx/internal/context-migration.json
---

# Project usage contract

This project provides a local application for registering project directories, talking to a team or a solo agent, configuring model providers, observing live work, inspecting retained context and explicitly activating current member configuration files. Browser and Electron clients use the same React application and backend protocol. Persistent records are in MySQL; project files and context documents remain on the host filesystem.

## Start and use

Use the repository's Node 22.19.x toolchain and locked package dependencies. With Docker Compose available and the private project configuration reviewed, a development session is:

```sh
nvm install
nvm use
npm ci --prefix backend
npm ci --prefix frontend
./scripts/dev.sh init
./scripts/dev.sh start
./scripts/dev.sh status
```

Initialization creates a private `rsi.config.json` from the checked-in example and generates new secrets when configuration is absent. Do not replace an existing configuration or encryption keys. Open the frontend address reported for the configured environment; ports are configuration values, not universal constants. Configure a provider and model, then add a project directory or start a conversation. Workspace registration inspects existing managed metadata and requires a matching reviewed cleanup revision before non-context metadata is discarded. Cancellation of that review performs no registration or cleanup.

A workspace starts with a Lead. Member files live under that project's `.rsi/members/`. Validation reports proposed changes; only explicit activation while the workspace is idle stores the new active team snapshot. A source edit or Git commit does not activate it. In a team only one member executes at a time; accepted final responses become shared publications and a leading mentions block can hand work to one other active member. Private model/tool work remains private. Solo conversations do not require a project team.

Work may change ordinary files, Git or external systems using the backend OS account. File and Default React Harness tools currently have no design-scope, path, command or Git approval gates. Design assignments describe responsibility. Tool failures can follow partial external or filesystem effects; there is no automatic rollback or replay guarantee for them.

The UI displays stable history and transient progress, with bounded history paging and explicit errors. Navigating away or disconnecting a stream does not cancel independent backend work; use an explicit cancellation action where supported. Context inspection is read-only and revision-pinned; after a conflict reload the first page. Group summarization and private Agent compaction are distinct mechanisms; neither deletes original public history.

## System contracts

| System | Provides | Usage contract |
| --- | --- | --- |
| Backend | Core services, durable state and HTTP/SSE API | [Backend](../backend/_ctx/README.md) |
| Frontend | Shared React application, navigation and feature workflows | [Frontend](../frontend/_ctx/README.md) |
| Operations | Private configuration, isolated database service, development and committed-release lifecycle | [Operations](../scripts/_ctx/README.md) |
| Desktop | Electron host, static renderer assets and proxy to an external backend | [Desktop](../desktop/_ctx/README.md) |

Operations' optional `./scripts/desktop.sh start development` starts the selected backend, temporarily writes Desktop's per-user connection configuration and runs Electron in the foreground. Electron itself does not supervise a backend. On exit the launcher restores the prior Desktop configuration and stops only a backend it started; the database stays running. Deployment mode requires a selected committed release. Development and deployment use separate database accounts, schemas and encryption keys within this checkout's configured MySQL service. Database isolation does not duplicate registered project directories.

Restart preserves durable messages/configuration and marks abandoned runs interrupted rather than replaying tools; transient stream chunks are lost. One backend owns a database at a time. Application stop preserves the database service/data. Build failure preserves the selected running release; launch failure attempts recovery, without undoing application migrations or external effects.

## Context maintenance

Current project context is under `.rsi/rsi-agent/`. A directory design part owns `_ctx/`; a file design part owns `<full-file-name>.ctx/`. Ordinary children are documented in their nearest owning design part. `DESIGN.md` records user intent; each usage README records implementation. No internal-context format is prescribed. The existing [reference map](internal/context-migration.json) resolves historical assignment identifiers; it does not restore the retired `.rsi/context/` layout.

README front matter supplies `summary` and project-root-relative `include` references. The filesystem manager explicitly refreshes a metadata-only index. Full consumer loading expands includes on request; File Harness dependency refresh loads only dependency READMEs and does not automatically load their inclusions. Its user-input checkpoint follows 64 completed context messages, preserving working content and immutable history. See [Workspace](../backend/src/core/workspace/_ctx/README.md) and [React Harness](../backend/src/core/react-harness/_ctx/README.md).

## Design alignment requiring confirmation

The following are documentation/design discrepancies, not changes made by this context review:

- Core DESIGN still calls shared group summarization deferred, while Team DESIGN and implementation provide it. Team DESIGN also contains earlier directory-history-alias retention language and a later requirement to discard those aliases; implementation follows the later migration rule.
- App/Frontend DESIGN describes four navigation destinations; the current shell has Conversations and Config sections and query routes for Home, Providers, solo conversation and workspace. Home's workspace list lives in App. Workspace implements group chat with Context, activation and model panels rather than the broader optional tab inventory.
- Desktop DESIGN describes supplying a backend origin to the renderer. Implementation retains it in main and supplies a `teamwork://app/api/` proxy base. Confirm the proxy architecture wording before changing DESIGN. A public-distribution authentication boundary is not yet decided.
- React Harness dependency discovery observes File-tool aggregates, not arbitrary source printed by Bash/search. Exact file edits normalize mixed line endings. Confirm whether the broader DESIGN wording requires additional implementation coverage.
- Shared's generic inspector is implemented; rich Pi/assistant-ui rendering lives in Workspace, but the richer Shared viewer example and fixture/interaction coverage described in UI DESIGN are incomplete. Decide whether to complete that reusable example or revise its scope. Resource client classes are exported despite DESIGN describing one public facade; application composition does use that facade.
- Operations DESIGN still requires an explicit harness-permission switch, whereas Runtime DESIGN and current launchers ignore the retired setting. Resolve this outdated requirement without reintroducing permission gates.

Other implementation limitations are recorded in the owning contracts. Historical completion of the one-time deployment database copy cannot be proven from checked-in files; do not infer it from old operational prose. Existing ordinary source READMEs/member instructions contain stale references, including retired context paths, a missing migration narrative and an unverified arm64 packaging claim. They were not treated as current contracts or automatically repaired outside this context-only task.

This reconstruction preserves all DESIGN documents, member configuration and application code. It adds no service activation, data migration, package installation or Git commit.
