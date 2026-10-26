# Workspace

## Purpose and responsibilities

Workspace presents information and actions scoped to one selected workspace. It is the workspace-level container in the initial navigation model, with internal tabs/sections rather than separate top-level destinations. Workspace feature composition does not require every section to share one implementation or state model.

## Initial tab structure

The workspace page may provide these sections:

- **Overview** — workspace identity and summary.
- **Files** — browse and inspect workspace files.
- **Design** — inspect and manage design documents.
- **Team/Members** — inspect members and configuration, and expose existing review/activation controls.
- **Changes** — inspect changes and supported review/commit approval workflows.
- **Settings** — workspace-specific settings supported by the backend.

This list describes initial organization; preserve existing backend capabilities and user workflows. These sections are composed inside Workspace and do not expand global navigation.

## Interface contract

Workspace uses the shared backend client and composes shared UI with workspace-scoped state and interactions. It submits required identities/revisions and presents backend refusals explicitly. Backend owns workspace registration, files, design/member records, validation and durable effects.

**Input:** selected workspace identity, backend records, revisions and user actions.

**Output:** tabbed workspace information, explicit requests and visible success/conflict/error outcomes.

**Effect:** browser-side selection/tab state and user-authorized backend requests; no frontend authority over durable project state.

**Usage example:** after selecting a workspace from Home, a user opens its Design or Team tab; the feature requests the relevant records and displays the latest backend result and revision-aware outcomes.

### Workspace initialization review

Workspace creation/adoption must use the existing review flow: inspect the target directory first; when non-context `.rsi` metadata is nonempty, show the canonical directory and cleanup paths, explain that context and source are preserved, and require explicit revision-bound confirmation before cleanup. Cancel makes no create request; a changed cleanup revision requires a fresh review. See the Frontend overview and accepted Workspace design for the full contract.
