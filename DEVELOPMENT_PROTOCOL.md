# Contract-first development protocol

## 1. Purpose

Develop a system by dividing it into smaller systems while keeping the knowledge shared between the user and the agent as small as possible.

For any chosen system, its `design.md` must be sufficient for a user or caller to understand, use, and evaluate that system. The user need not read its `impl.md`, its children's documents, or its source code. The agent is responsible for making those lower levels satisfy the chosen design.

"User" means whoever consumes a system's behavior. At the top level this may be a person; at a lower level it may be another subsystem.

## 2. Core rules

**The overriding invariant: every commit must be a truthful, tested snapshot. At that commit, every canonical `design.md`, canonical `impl.md`, and piece of code must agree.** Task copies of these documents are explicitly proposed designs, not claims about current behavior. A task may contain several new designs and several partial commits. No task schedule or desire for a small commit overrides this invariant.

1. **One boundary, one contract.** Every system has a `design.md` describing its observable behavior from outside its boundary.
2. **Implementation is private to the boundary.** Its `impl.md` explains how that behavior is produced, including any child systems. It may change without changing `design.md` when the observable contract remains true.
3. **Decompose through contracts.** A parent implementation may delegate responsibilities to child systems. Each child has its own `design.md` written for its caller, usually the parent. The parent's design never requires the reader to follow these links to understand the parent.
4. **Keep the shared model small.** The user and agent need to agree on each selected system's contract, not on its internal structure. The agent carries the detailed model and reconciles it across descendants, code, and tests.
5. **Make behavior testable.** A design states what can be observed, including important effects and failures. An implementation states how to verify that its code satisfies the design.

These rules apply recursively. A child is a whole system when viewed from its own boundary.

### Implementation principles

#### 1. The new design determines the implementation

- Derive operations, code logic, module responsibilities, state, and effects from the task draft `design.md`. The old implementation is evidence of what exists, not the model for the new code.
- Reuse old design or code where it fits the target cleanly. Reshape or replace logic built around assumptions the new design changes.
- Do not bolt new behavior onto old paths with compatibility branches or fallbacks merely to keep old behavior alive. Keep unchanged guarantees that the new design still promises, including required failure behavior.
- Surface a conflict with the target in the draft design and resolve it with the user instead of hiding it in code.

#### 2. Prefer clear, simple, unified logic

- Use one straightforward flow for each behavior. Unify equivalent cases instead of maintaining parallel paths.
- Keep each module cohesive and self-contained, with explicit inputs, outputs, effects, and ownership of its decisions and state.
- Make validation and failures direct and understandable. Add a special case, retry, adapter, or fallback only when the new design calls for it.
- Remove obsolete branches and duplication created by the change. Keep unrelated code intact when it already fits the design.

## 3. Document ownership and layout

Use one stable documentation tree, separate from the source-code layout:

```text
DEVELOPMENT_PROTOCOL.md
docs/
  systems/
    order-placement/
      design.md              # current external contract
      impl.md                # current realization and code map
      inventory-reservation/
        design.md
        impl.md
    payment/
      design.md
      impl.md
  tasks/
    2026-09-29-order-confirmation/
      task.md                # discussion, decisions, and progress
      tests.jsonl            # one record per test run
      drafts/
        order-placement/    # mirrors the path under docs/systems/
          design.md          # proposed contract
          impl.md            # proposed realization
        payment/
          design.md
          impl.md
src/                         # illustrative; actual code may live elsewhere
```

`docs/systems/<system-id>/` is the canonical home of one system's `design.md` and `impl.md`. Nest a child beneath its owning parent. A system used by several parents has one canonical directory; each parent's `impl.md` links to it rather than copying it. The documentation hierarchy represents ownership and decomposition, not necessarily the source tree or every runtime call.

Use stable, readable directory names. Give each significant code entry point one owning system, named in that system's `impl.md`; other systems link to it. Link to the relevant code, tests, and child designs from `impl.md`; keep `design.md` independent of those paths. Avoid copying a child's full contract into its parent: name the required capability and link to the child's `design.md`. Move a system's documents and repair links in the same commit that changes its ownership. Retire its canonical documents with the system; Git retains their history.

`docs/tasks/<task-id>/` holds temporary work context and permanent evidence. Give each task a unique, readable ID, for example `YYYY-MM-DD-short-name` with a suffix if needed. Put each new or changed system document under `drafts/<same path as docs/systems/>/design.md` or `impl.md`. For an existing system, copy its canonical document as the starting point; for a new system, create the draft there. The directory path marks these copies as proposed, including when task files appear in a partial commit. At each commit, the canonical `docs/systems/` documents and code are authoritative.

Keep historical discussion and proposed future behavior in task files; keep canonical system documents focused on the current contract and enduring implementation decisions. There is no separate system index to keep in sync.

A system should be split when a child has a coherent responsibility and a meaningful contract that lets the parent reason about it without its internals. Do not create a child solely to make files smaller or to mirror every class or function. A leaf system still has an `impl.md`; it can be brief and point directly to its code and verification.

## 4. `design.md`: the external contract

Write this document from the system's user or caller perspective. It answers **what the system promises**, not how it works.

Required sections:

```markdown
# <System name>

## Purpose and boundary
Who uses this system, what outcome it provides, and what is outside its responsibility.

## Inputs and preconditions
Operations, accepted data, relevant prior state, and conditions the caller must meet.

## Outputs and observable effects
Results, state changes, external actions, and their timing or ordering where relevant.

## Failure behavior
Invalid input, unavailable dependencies, partial failure, retries, and what the caller can observe.

## Guarantees and limits
Invariants and any relevant performance, security, durability, or compatibility promises.

## Acceptance examples
Representative input → output/effect cases, including important edge and failure cases.
```

Use precise language. State whether an operation is idempotent, atomic, ordered, or eventually consistent when callers depend on that property. State what is unspecified when implementations may vary. Do not describe internal algorithms, storage, framework choices, child systems, or file layout unless they are themselves part of the caller-visible promise.

A design is **sufficient** when a reader can use and assess the system without opening another document. It is **bounded** when it does not prescribe implementation details that callers cannot observe.

## 5. `impl.md`: the realization

Write this document for the agent or developer who builds and maintains the system. It answers **how this system fulfills its design**.

Required sections:

```markdown
# <System name> implementation

## Contract
Link to this system's design.md and identify the guarantees most likely to be affected by changes.

## Responsibilities and decomposition
What this implementation owns; each child system, its design.md link, and why the child exists.

## Coordination and data flow
How inputs move through the implementation, how children interact, and where state and effects live.

## Decisions and constraints
Important choices, reasons, tradeoffs, assumptions, and constraints on future changes.

## Code map
Entry points and the files or packages that realize this system.

## Verification
How each important design guarantee is checked, and where the relevant tests or checks live.
```

The parent `impl.md` must show how its child contracts together fulfill the parent's design. A link to children alone is not an explanation of composition. If a required behavior falls between children, the parent implementation owns the coordination and documents it.

## 6. Development workflow

Each development effort is one **task** with one or more design outcomes and a recorded starting commit. The task organizes discussion and work; a commit is the unit of consistency. A task may span several work sessions and produce several partial commits, provided each commit satisfies the overriding invariant.

### A. Open the task and choose the review boundary

Identify the system or systems whose behavior the user wants to discuss. Create `docs/tasks/<task-id>/task.md` with the selected review boundaries, intended design outcomes, and the full SHA of the task's starting commit before changing files. Start from a clean worktree or an isolated worktree; a commit SHA alone cannot restore uncommitted changes that were already present.

The user may read the canonical `design.md` to understand current behavior, then reviews the task's draft `design.md` for the proposed behavior. The agent may inspect implementations and descendants to do the work, but should present decisions about behavior at the selected boundaries.

### B. Discuss the new design

The user describes the desired behaviors, constraints, and examples. The agent writes them into the task's draft `design.md` files and discusses behavioral choices with the user. The user need not prescribe implementation steps. If the user's design is already unambiguous, the agent can proceed without a separate approval ritual.

For each new system, write its task draft `design.md` before committing to an internal decomposition. For an existing system, identify what changes in the contract and what stays true. Resolve material ambiguity at its review boundary with the user; choose routine internal details independently. Keep canonical `docs/systems/` files unchanged through discussion and development. A task draft remains a target until code implements it.

### C. Decompose only as needed

Draft or revise `impl.md` inside the task directory. Give each child one clear responsibility and a task draft `design.md` expressing what the parent needs from it. Check that the child contracts and the parent's coordination are sufficient to satisfy every parent guarantee. Continue recursively until a leaf can be implemented and verified directly.

### D. Implement and verify

Implement according to the two principles above. Update each affected task draft `impl.md` to match the intended structure and decisions. A partial checkpoint is verified against the canonical design proposed for that checkpoint, which may cover only part of the task draft. Keep examples and links accurate. Append every test run, including failures, to `tests.jsonl` as described in section 7. If code or contract changes after a successful test, rerun the affected checks.

### E. Reconcile upward and downward

After a change, check the affected path in the hierarchy:

- **Downward:** Do child contracts and code still provide what the parent implementation requires?
- **Upward:** Does the parent still meet its design, and do affected ancestor designs still hold?
- **Sideways:** Do callers or sibling systems need a contract update because their assumptions changed?

The agent performs these checks. The user only needs to review a change to a selected system's `design.md` when its observable behavior changes or a behavioral choice is needed.

### F. Commit a consistent checkpoint

For a checkpoint, promote only the completed behavior from task drafts into the matching canonical `docs/systems/` files, alongside the code and tests that realize it. Prepare these canonical changes as part of the candidate commit, not during earlier design discussion. A partial commit need not promote every proposal in the task drafts; canonical documents must describe only behavior present in that commit.

Check the commit criteria in section 9 and run the required tests against the exact candidate code, canonical designs, canonical implementations, and tests. If the working tree also contains unfinished work, isolate the candidate commit for verification; tests run against extra uncommitted changes do not establish that the commit passes. Then append the test results to `tests.jsonl` and commit the canonical files, code, and task files together. A partial commit may leave other task goals for later, but it must be internally complete and consistent.

After a partial commit, continue the task from that new commit. If the next proposed increment fails or is blocked, keep that increment uncommitted and report its status; earlier consistent commits remain valid.

## 7. Task documents and test evidence

Keep `task.md`, `tests.jsonl`, and the proposed system documents under `docs/tasks/<task-id>/`. They record the task's target and history; they do not replace the canonical documents under `docs/systems/`.

### `task.md`

Create this when the task begins and update it when the design discussion reaches a decision, a checkpoint is committed, or the remaining work changes. Keep it short:

```markdown
# <Task ID>

Status: proposed | active | blocked | complete
Task start commit: <full SHA before any task work>
Review boundaries: <links to the selected task draft design.md files>

## Design outcomes
- [planned | delivered] <behavioral outcome and links to its draft and canonical design.md>

## Decisions and open questions
<What the user and agent agreed; unresolved behavioral choices.>

## Checkpoints and remaining work
<What each partial commit delivered, what remains, and links to test evidence.>
```

Distinguish **planned** behavior from **delivered** behavior. Record the reason for a material design decision, but do not copy the full contract here. Canonical `design.md` states current behavior; task notes explain how the task arrived there. Mark the task complete in its final consistent commit.

### `drafts/`

Mirror each affected system's relative path beneath `docs/systems/`, with its proposed `design.md` and `impl.md`. Put `<!-- Task proposal; current contract is under docs/systems/ -->` at the top of each draft and remove it when promoting content. Update drafts during discussion and development. The draft design is the user's review surface for new behavior; the draft implementation is the agent's plan. If the target changes, revise the drafts and record material decisions in `task.md`. Keep them in the task directory after completion as the task's design record. Readers seeking current behavior use `docs/systems/`.

### `tests.jsonl`

Append one JSON object for every test run, including failures and blocked runs. Each object records its time, exact command or manual procedure, scope or relevant environment, result, and `start_commit`: the full SHA before the candidate increment being tested. The `task.md` separately records the task's original starting SHA.

```jsonl
{"time":"<ISO 8601>","start_commit":"<full SHA before this increment>","command":"<exact command or manual procedure>","scope":"<behavior checked>","result":"pass | fail | blocked"}
```

Append a run when it finishes; do not rewrite an earlier result to make the history look clean. If a test result needs correction, append a correction identifying the earlier run. Include the current `task.md` and `tests.jsonl` in each partial commit. The task starting SHA identifies the state before all task work; each test's starting SHA identifies the state before that partial increment.

Add a `Task-ID: <task-id>` trailer to every task commit. Git history supplies the resulting commit SHAs, which a commit cannot write into its own files. Together, the task's starting SHA, each test's starting SHA, and task-tagged commits identify the changes to revert for a whole-task or partial rollback without discarding unrelated later work.

## 8. Change rules

| Change | Required action |
| --- | --- |
| Observable behavior of system `S` changes | Discuss and update the task draft `S/design.md`; promote the completed part with code and verification at a commit. Check affected descendants and callers. |
| Internals of `S` change but its contract holds | Update the task draft `S/impl.md`; promote it with code at a commit and verify canonical `S/design.md` still holds. |
| A child contract changes | Update its task draft `design.md`; check the parent implementation and all callers. Promote the child design at a commit; change the parent design only if parent-visible behavior changes. |
| A new child is introduced or removed | Update task draft documents for the parent and child. Promote the completed structure, code map, and verification together at a commit. |
| Code and documents disagree | Treat it as unfinished work. Decide the intended behavior at the relevant design boundary, then bring documents, code, and checks into agreement. |

When an implementation cannot meet an agreed design, the agent must surface the conflict at the selected boundary with concrete options. It must not silently weaken the contract or hide a new limitation in `impl.md`.

## 9. Commit and task completion criteria

A commit is allowed when:

1. Every affected canonical `docs/systems/**/design.md` accurately states the behavior present in that commit and remains understandable on its own. Future task drafts remain explicitly under `docs/tasks/`.
2. Every affected canonical `docs/systems/**/impl.md` describes the implementation present in that commit and its child relationships.
3. Child contracts and parent coordination together cover every affected parent guarantee.
4. The candidate code, designs, implementations, and tests passed meaningful verification, including relevant failure and effect behavior. Only the task files were updated afterward to log the results and progress.
5. No known contradiction remains along the affected path to callers or ancestors.
6. `task.md` names the task starting commit, and `tests.jsonl` records every run with its increment starting commit; required checks passed after the final behavior-affecting edit in this increment.

The task is complete when all agreed design outcomes have been promoted and implemented through commits that meet these criteria. At completion, accepted task drafts and their canonical counterparts describe the same final state; mark superseded proposals in `task.md`. The agent's handoff should summarize behavior changes at the user's selected boundaries, the task's starting and resulting commits, evidence of verification, and any unresolved contract decision. Internal details may be linked for inspection but are not required reading.

## 10. Small example

Suppose the selected system is **Order placement**. Its `design.md` says a valid request either returns a confirmed order and charges once, or reports failure without a charge. The user can evaluate that promise without knowing the internal components.

Its `impl.md` may divide the work into **Inventory reservation**, **Payment**, and **Order persistence**, each with its own `design.md`. The parent implementation specifies their order, failure handling, and compensation. If payment is replaced while the external promise stays true, only implementation and child documents change. If the system begins returning pending orders, the order placement `design.md` must change because the user's observable contract has changed.

During that task, proposed order and payment documents live under `docs/tasks/<task-id>/drafts/`. If the first partial commit delivers only the payment change, it promotes the relevant payment documents with payment code and tests; the canonical order design still describes the old order behavior. A later tested commit promotes the pending-order contract and its implementation. Both commits leave canonical documents consistent with their code.
