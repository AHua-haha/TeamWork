# Agent task prompt

Use this prompt with a task ID after the user and agent have begun discussing the proposed design. Fill in the task ID and review boundaries; the task draft documents contain the detailed target.

---

Task ID: `<task-id>`

Review boundaries: `<paths to the systems the user is reviewing>`

Complete this task according to `DEVELOPMENT_PROTOCOL.md`. Read `docs/tasks/<task-id>/task.md`, its draft `design.md` and `impl.md` files, the corresponding canonical documents under `docs/systems/`, and the relevant code. The task drafts express the **new design**. The canonical documents express the **currently committed behavior**.

## Goal

Implement the new design expressed by the task drafts. Discuss material ambiguities about observable behavior with the user at the selected design boundary. The user provides the desired behavior; determine the implementation yourself.

## Implementation principles

### 1. The new design determines the implementation

- Derive operations, code logic, module responsibilities, state, and effects from the task draft `design.md`. The old implementation is evidence of what exists, not the model for the new code.
- Reuse old design or code where it fits the target cleanly. Reshape or replace logic built around assumptions the new design changes.
- Do not bolt the new behavior onto old paths with compatibility branches or fallbacks merely to keep old behavior alive. Keep unchanged guarantees that the new design still promises, including its required failure behavior.
- If the target cannot be implemented as written, surface the conflict in the draft design and resolve it with the user instead of hiding it in code.

### 2. Prefer clear, simple, unified logic

- Use one straightforward flow for each behavior. Unify equivalent cases instead of maintaining parallel paths.
- Keep each module cohesive and self-contained, with explicit inputs, outputs, effects, and ownership of its decisions and state.
- Make validation and failures direct and understandable. Add a special case, retry, adapter, or fallback only when the new design calls for it.
- Remove obsolete branches and duplication created by the change. Keep unrelated code intact when it already fits the design.

## Work and commit sequence

1. Identify the differences between canonical and draft designs. Use the task drafts as the target; leave canonical documents unchanged during discussion and development.
2. Choose coherent increments if the task needs partial commits. For each increment, determine the behavior it will fully deliver.
3. Implement the increment and its meaningful tests. Keep the task draft `impl.md` aligned with the implementation. At commit preparation, promote only delivered design and implementation content from the task drafts into canonical documents. Leave future proposals in the task directory.
4. Test the exact candidate code and canonical documents for that commit. Record every test run, including failures, in `docs/tasks/<task-id>/tests.jsonl` with the full starting commit SHA for that increment. Rerun affected checks after any behavior-affecting edit.
5. Commit only when canonical `design.md`, canonical `impl.md`, code, and tests agree. Include the task files and a `Task-ID: <task-id>` commit trailer. Continue the remaining task from that commit.
6. Follow the protocol's branch review workflow: by default, work and review on a feature branch in the existing project base folder. Keep review fixes on that branch, and merge into `main` after the user accepts the work and authorizes the merge. Push when requested.

Before each commit, check for obsolete branches, duplicated behavior, unnecessary fallbacks, and any mismatch between the new design and the code.

When the task is complete, report the behavior delivered at the user's review boundaries, the implementation choices that matter, test results, task starting commit, resulting commits, and any remaining limitation.
