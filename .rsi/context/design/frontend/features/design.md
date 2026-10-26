# Features

## Purpose, responsibilities and boundaries

Features own the user-facing workflows, state and feature-specific composition. They compose Shared UI and call the one public backend client. They may interpret backend records and shape feature-specific presentation state; Shared transport does not.

## Top-level features

- [Home](home/design.md) — landing page, workspace overview/list and quick actions.
- [Providers](providers/design.md) — provider connections, credentials and model configuration.
- [Chat](chat/design.md) — conversation interaction, composer, history and live progress.
- [Workspace](workspace/design.md) — selected-workspace information presented in tabs, including sections such as Overview, Files, Design, Team/Members, Changes and Settings. These sections remain within Workspace rather than becoming top-level navigation destinations.

## Constraints

- Keep the initial top-level experience limited to these four areas.
- Backend remains authoritative for validation and durable state.
- Preserve editable user input and present explicit failures where existing behavior requires it.
