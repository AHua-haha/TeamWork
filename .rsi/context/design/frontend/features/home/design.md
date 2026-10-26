# Home

## Purpose and responsibilities

Home is the application landing experience. It presents the workspace overview/list and quick actions such as opening or creating a workspace. It helps users choose where to work and does not absorb detailed workspace tabs or provider/chat workflows.

## Interface contract

Home uses the shared backend client to request workspace API records, maintains any required page interaction state, and composes shared UI. Backend remains authoritative for workspace registration and creation.

**Input:** navigation and user actions, workspace API records and request outcomes.

**Output:** a landing view, workspace selection/navigation and explicit creation/opening outcomes.

**Effect:** browser-side state and backend requests initiated by explicit user actions; no local authority over durable workspace state.

**Usage example:** a user selects a listed workspace to navigate to its Workspace area, or starts the workspace creation flow.
