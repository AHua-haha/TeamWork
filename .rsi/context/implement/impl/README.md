## Result summary

The project is a local single-operator application for coordinating AI-agent teams over registered software workspaces. The accepted root design spans a Node.js/TypeScript backend, browser frontend, MySQL persistence, managed design/implementation context, and local development/deployment operations. User-reviewed design/member changes are distinct from implementation work; ordinary Git is the history mechanism.

Implementation-context rebuild is underway after the legacy implementation-context tree was cleared. Backend Layers reports context for Backend API, Foundation, Runtime, and Storage; Backend Core reports context for the Backend Domain parent and its six child systems. Frontend and Operations have not yet reported their implementation-context inspection. These are reports, not independent verification of every document. Existing project-source edits and deletions must be preserved; this task must not modify, stage, or revert source.

## File lookup

| Path | Description |
|---|---|
| `.rsi/context/design/design.md` | Accepted product-level purpose, interface, lifecycle and constraints. |
| `.rsi/context/design/backend/` | Backend layer and domain designs. |
| `.rsi/context/design/frontend/` | Frontend and group-chat designs. |
| `.rsi/context/design/operations/` | Local development, deployment and shared-database designs. |
| `.rsi/context/implement/backend/` | Backend Layers and Backend Core implementation contexts reported complete. |
| `.rsi/context/implement/frontend/` | Frontend implementation context, pending member inspection. |
| `.rsi/context/implement/operations/` | Operations implementation context, pending member inspection. |
| `.rsi/context/implement/impl/README.md` | Product-level implementation context and overall continuation status. |

## Automatic retrieval

```json
{"commands": []}
```

## Implemented contract

### Input
The application accepts workspace directory/name and model settings, user chat text and prepared image attachments, provider configuration, and explicit user review/acceptance/activation decisions. Exact HTTP payloads and UI interactions are specified by backend and frontend child designs.

### Output
The product provides workspace/team state, shared timeline and private execution traces, design/member review information, commit-approval requests, and lifecycle status through loopback HTTP, SSE feeds, and the browser UI.

### Effect
It persists runtime, workspace, team, and configuration state in MySQL and writes context/member files under registered project directories. It provides member tools for project operations and uses ordinary Git history; it does not create per-member repositories or checkpoints.

### Failure behavior
Invalid or conflicting operations are refused without claiming success. Run failures remain visible as terminal execution state. Restart may mark abandoned runs interrupted rather than replaying them. Exact error contracts belong to child systems.

### Usage example
Register a project directory as a workspace, configure available models, address the team in group chat, review proposed design/member changes, and explicitly accept/activate them before implementation work relies on them.

## Verification and continuation

This is a product-level summary, not a substitute for child-system contracts. Backend implementation contexts have been reported by their owners; frontend and operations remain to be examined against accepted designs and actual source. No project source was changed for this context update. Preserve the existing unrelated source modifications and deletions.

Root design: `.rsi/context/design/design.md`. No automated retrieval is needed.

## Contract detail

### Input
Workspace creation receives name, directory, lead configuration and optional model defaults. Group chat accepts text and optional prepared images and can route to explicitly mentioned members. Configuration and design/member changes are reviewed and activated through separate user-authorized actions.

### Output
The system exposes persistent workspace and team state, timeline entries, agent-run status/progress, context/design review data, member activation outcomes, and Git approval requests. The browser consumes JSON endpoints and SSE updates.

### Effect and failure
Persistent records live in MySQL; managed context and source live under workspace directories. Failures must remain explicit, including validation/conflict failures and terminal agent errors. This root-level contract summarizes the accepted product design; use the corresponding child implemented contracts for concrete signatures and edge cases.

### Example
A user registers a workspace, configures its models, starts a group-chat exchange mentioning a member, follows the resulting work, reviews any requested commit/configuration approval, and explicitly activates reviewed member configuration before it is used.