# 2026-09-30-config-system

Status: complete
Task start commit: 61eb7246df9f6b1860a784c0af4120ad43d6d66e
Review boundaries: [Config system](drafts/config/design.md), [Frontend system](drafts/frontend/design.md), and [Local development lifecycle](drafts/local-dev/design.md)

## Design outcomes

- [delivered] [Config system](drafts/config/design.md): four config scopes, editable-data operations, provider-first model choices, snapshot resolution, and next-run effects.
- [delivered] [Frontend config feature](drafts/frontend/design.md): Agents catalog with separate Models, Prompts, and Tools tabs, per-agent configuration, App Settings, and persistent composer controls.
- [delivered] [Local development lifecycle](drafts/local-dev/design.md): one script to start, stop, and inspect the local MySQL/backend/frontend stack.
- [delivered] [Agent runtime integration](drafts/agent-runtime/design.md) and [database persistence](drafts/database/design.md): run-local config resolution and durable editable records. Legacy model selections migrate at startup.

## Decisions and open questions

- System config controls backend startup and is deployment controlled. The UI CRUD API edits only editable app config, global agent catalog data, and per-agent config.
- App config controls product-wide UI and API behavior. The global agent catalog declares permitted options rather than agent defaults. Each agent stores its own selections.
- Editable config may change at any time. A consumer resolves an immutable copy at a defined point, does not lock source records while using it, and sees edits only after resolving again.
- Each agent run resolves its run-affecting config before acceptance, keeps that snapshot until it ends, and resolves current committed config for the next run.
- The Agents area contains the global catalog, agent list, per-agent configuration, and chat. App Settings is a separate destination; system config has no UI editor.
- Composer model, reasoning, and model-call controls edit the agent's saved config rather than creating one-run overrides. An active run keeps its earlier snapshot; edits apply to later runs.
- The delivered schema includes app title/input-size/creation settings; provider connections and tool/prompt catalog entries; and agent provider/model selections, instructions, reasoning, temperature, maximum output tokens, and context budget. The executable registers no tools by default, so tool options become available when handlers are registered in code.
- Editor authorization and exposing the exact config used by an individual finished run remain future decisions. The current local backend has no built-in authentication, as before this task.
- On 2026-09-30 the user requested separate Models, Prompts, and Tools catalog tabs and a model editor with provider, model name, URL, and API key. The current implementation uses reusable provider connections under Models so one credential and URL can serve multiple agents and models. Connection keys are encrypted in MySQL and write-only in the API; their encryption key remains deployment-controlled system config.
- The user clarified that the model ID is backend-owned and must not be entered in the model editor. The UI selects backend-provided model names per agent. The backend retains the provider-specific ID for requests. Known models come from Pi's catalog; custom OpenAI-compatible endpoints can expose their IDs via explicit discovery. An unknown discovered model receives conservative text-only capabilities until registered in the backend.
- A DeepSeek connection configured for Anthropic Messages exposed a mismatch: Pi's built-in DeepSeek model defaults to OpenAI Chat Completions. The connection's selected protocol now governs calls to Pi-known as well as discovered models, while known models retain Pi identity and capability metadata. The matching endpoint URL is supplied in the same connection.

## Checkpoint and remaining work

- Implementation was authorized on 2026-09-30; the user requested review before committing and authorized the commit on 2026-10-01. The completed drafts are promoted together with the implementation to their canonical system documents.
- Earlier iterations and failures, including the stale editor revision and the DeepSeek protocol mismatch, are recorded in [tests.jsonl](tests.jsonl). The final behavior was checked through disposable-MySQL integration tests, package tests/builds, and a live DeepSeek run shown in a fresh browser view.
- The local MySQL, backend, and frontend stack remains running for review. This task has no remaining implementation work.
