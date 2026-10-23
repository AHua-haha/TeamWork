# Development instructions

For software development tasks in this workspace, follow [DEVELOPMENT_PROTOCOL.md](DEVELOPMENT_PROTOCOL.md). Use [AGENT_TASK_PROMPT.md](AGENT_TASK_PROMPT.md) as the standing implementation instructions. Read the relevant sections and the current task documents before changing code; the user does not need to paste either file into a new chat.

## Working agreement

- Treat the user's proposed behavior as the design discussion. Keep design and implementation drafts under `.rsi/work/tasks/<task-id>/drafts/`. The canonical documents under `.rsi/context/design/` and `.rsi/context/implement/` describe currently committed behavior.
- Let the new design determine code logic and module responsibilities. Reuse old code where it fits; reshape it where it does not. Prefer clear, simple, unified logic and self-contained modules.
- A task may contain multiple designs and partial commits. At **every commit**, canonical `design.md`, canonical `impl/README.md`, tests, and actual code must agree. Promote completed draft content with its code, verify the candidate, and record each test run with its starting commit as the protocol specifies.
- Present behavioral choices at the user's selected system boundary. The agent owns implementation detail and consistency across child systems.

Use the full protocol and task prompt for development work. For unrelated questions or edits to these process documents, read only what the request needs.

## Context and ownership

Use the RSI context roots as the only maintained project context. Frontend, Backend and Operations are the top-level systems; Backend contains aggregate Core, API, Storage and Runtime. Core owns business models and their durable schemas/SQL/migrations. Storage provides engine resources without business schema knowledge. Keep Core aggregated until its internal design is discussed. Add only intended `.rsi/context` and task records to Git, never member/runtime metadata or secrets.
