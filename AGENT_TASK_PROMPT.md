# Agent task prompt

Task ID: `<task-id>`
Review boundaries: `<selected system paths>`

Follow [DEVELOPMENT_PROTOCOL.md](DEVELOPMENT_PROTOCOL.md). Read `.rsi/work/tasks/<task-id>/task.md`, proposed `drafts/design/` and `drafts/implement/`, matching canonical `.rsi/context/design/` and `.rsi/context/implement/`, and relevant source. Drafts are the target; canonical context describes committed behavior.

1. Write the agreed boundary design first. Let it determine code, state and module ownership; reuse existing code only where it fits. Resolve material behavioral choices at the user's selected boundary.
2. Keep modules cohesive, data ownership explicit and logic simple. Remove superseded paths. Preserve agreed effects and failure behavior. Avoid compatibility branches unless the contract requires them.
3. Implement coherent increments. Keep proposed implementation context current. Follow the agreed Agent, Harness, Workspace and Team boundaries; assign in-memory and persistence ownership separately.
4. At commit preparation, promote delivered design and implementation context into canonical RSI paths. Use `impl/README.md` with Result summary, File lookup and Automatic retrieval; specify implemented input, output, effect and usage.
5. Test the exact candidate. Append every check (including failures) to `.rsi/work/tasks/<task-id>/tests.jsonl` with full increment starting SHA. Rerun affected checks after changes.
6. Commit only when source, canonical design, implementation context and tests agree. Include task records and a `Task-ID: <task-id>` trailer. Add only intended RSI context/task files, never runtime metadata or secrets.
7. Use the feature branch in the existing project folder for review. Merge and push when authorized. Report delivered behavior, test evidence, original and resulting commits, and any remaining limitation.
