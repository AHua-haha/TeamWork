# Contract-first development protocol

## Purpose and invariant

Develop through agreed system boundaries. A design must let a caller understand what a system does and how to use it without reading its implementation or children. The agent owns implementation consistency across those boundaries.

**Every commit is a truthful, tested snapshot: canonical design, implementation context, source and tests agree.** Task drafts describe proposed behavior, never current guarantees. A task may have multiple designs and partial commits; every commit must satisfy this invariant.

## Context ownership and structure

This project follows its RSI context model. There is one maintained context tree, with matching system paths under separate roots:

```text
.rsi/
  context/
    design/
      metadata.json
      design.md
      backend/
        metadata.json
        design.md
        core/                 # API, Storage and Runtime are siblings
          metadata.json
          design.md
          agent/              # each child has metadata.json + design.md
          harness/
          workspace/
          team/
      frontend/               # metadata.json + design.md
      operations/             # metadata.json + design.md
    implement/
      impl/README.md
      backend/
        impl/README.md
        core/impl/README.md
      frontend/impl/README.md
      operations/impl/README.md
  work/tasks/<task-id>/
    task.md
    tests.jsonl
    drafts/
      design/<matching-system-path>/design.md
      implement/<matching-system-path>/impl/README.md
```

`metadata.json` identifies a system node and contains only `{"implementation": ["project/path"]}`. Root/container nodes may map no source directly. Child nodes represent meaningful subsystems, not document topics or individual functions. Directory hierarchy defines system hierarchy. Each system is complete from its caller's perspective.

Design content uses `design.md` or `design/README.md` plus Markdown topic documents, never both forms. Implementation context uses `impl/README.md` plus optional Markdown references. Multiple documents inside design/ or impl/ still describe the same system. They do not create child systems. Keep context separate from source files, members and backend-managed runtime metadata.

The agreed top-level systems are Frontend, Backend and Operations. Backend has Core, API, Storage and Runtime. Core contains Agent, Harness, Workspace and Team. Each business system aggregates its core in-memory schema, durable representation and related data operations in its own data-model part. Agent owns its execution/context/history persistence; Team owns membership/configuration/shared-chat data; Workspace owns registry/context/files/models data. Core coordinates cross-owner atomic workflows through public owner operations. Core owns business models, memory, serialization, persistence schemas, SQL, queries, migrations and invariants. Storage supplies technical engine resources and transaction mechanics without business schema knowledge. API owns transport. Runtime owns process hosting and wiring; agent execution belongs to Core.

Do not create a parallel docs/ context. Root and package READMEs are entry guides that link to canonical context. Prior docs/tasks history remains available in Git; provenance is recorded in the migration task. Detailed behavior references live inside their owning system implementation context.

## Design document

Use these sections:

1. **Purpose, responsibilities and boundaries** — who uses it, what it owns, and relevant limits.
2. **Interface contract** — purpose and supported interactions; required inputs and returned information; observable effects and failures; relevant lifecycle rules and guarantees. Design specifies the behavior needed by callers without requiring premature implementation detail. Interfaces may be APIs, classes, processes, files or other interactions.
3. **Constraints, specifications and requirements** — caller-visible constraints and acceptance examples where useful.

A caller should understand the contract without opening source, implementation context or child designs. Keep behavioral decisions at the user's selected review boundary.

## Implementation context

Each `impl/README.md` has:

- `## Result summary`: current implementation result; coordination, ownership, important decisions and implemented contract. Document precise input, output, effects/failures and usage examples. Explain how child contracts and parent coordination meet the parent design.
- `## File lookup`: file/path descriptions for quick lookup, links to relevant code, tests, supporting documents and children. The runtime does not automatically load the linked files.
- `## Automatic retrieval`: exactly one fenced JSON block containing `{"commands": []}` or Bash tool inputs. Commands have actual Bash input format and may have effects; do not add commands merely for documentation. Empty is the default.

Keep canonical implementation context current and enduring. Keep proposals, task discussion and transient progress in task files. Assign each significant source responsibility to one system; callers refer to that owner's interface.

## Implementation principles

- Let the new design determine logic, state and responsibilities. Existing code is evidence, not the design to adapt around. Reuse where it fits; replace obsolete assumptions cleanly.
- Prefer cohesive modules, explicit ownership and one straightforward flow. Remove superseded logic and duplication created by the change.
- Preserve unchanged agreed guarantees, including failure behavior. Introduce fallbacks only for an explicit contract, such as restarting a previously selected deployment release.
- Do not silently weaken contracts. Surface material behavioral ambiguity or inability to meet the design at the selected boundary. Routine implementation decisions belong to the agent.
- Decompose only when a child has a coherent responsibility and useful contract. Do not add further child systems without a meaningful agreed boundary.

## Workflow

1. **Open task.** Create `.rsi/work/tasks/<YYYY-MM-DD-name>/task.md` before edits. Record full starting Git SHA, review boundaries, outcomes, prior local changes, safeguards and open decisions. Preserve unrelated local changes.
2. **Write design first.** Put proposed designs under `drafts/design/<system-path>/`. Read canonical context and relevant code. If the user's intent is unambiguous, proceed without another approval ritual. Canonical design remains unchanged during discussion.
3. **Plan implementation.** Put proposed implementation context under `drafts/implement/<system-path>/impl/README.md`. Identify coordination and ownership, then implement from that design. Decompose only as needed and agreed.
4. **Implement and verify.** Choose coherent increments. Test meaningful effects and failures. Record every check, including failed/blocked checks. Rerun affected checks after changing behavior or contracts.
5. **Reconcile.** Check downward to children, upward to parent guarantees and sideways to callers. The agent resolves internal consistency; the user reviews selected boundary behavior.
6. **Prepare candidate.** Promote only delivered draft content into matching canonical context alongside its code/tests. At every commit all current claims must be true. Unfinished proposals stay in drafts.
7. **Verify exact candidate and commit.** Verify source, canonical context, tests, assets and entry points as relevant. Update only task evidence afterward. Include task records and a `Task-ID: <task-id>` trailer. If unrelated unfinished changes are present, isolate the candidate so evidence actually covers what is committed.
8. **Review on feature branch.** Default to `codex/` branches in the existing project folder so the user can review in VS Code/shell. Preserve local changes before switching. Merge and push only when authorized. Worktrees are optional, not the default review location.

## Task records and evidence

`task.md` records status (proposed/active/blocked/complete), original full SHA, review boundaries, planned/delivered outcomes, decisions, checkpoints, remaining work and limitations. It does not duplicate full contracts. Mark completion only when all outcomes are implemented, promoted, verified and committed.

Draft paths mirror canonical context. Mark drafts as proposed at the top; remove that marker when promoting. Keep accepted task drafts as the historical record; use canonical context for current behavior.

Append one JSON object per test/check to `tests.jsonl`, including failures:

```json
{"time":"<ISO 8601>","start_commit":"<full SHA before increment>","command":"<exact command or procedure>","scope":"<environment and behavior>","result":"pass | fail | blocked"}
```

Do not rewrite failures. Append corrections identifying the original record when necessary. Task start SHA, per-check SHA and Task-ID commit trailers establish rollback provenance without discarding unrelated work.

`.rsi` is also used for runtime data and is ignored by Git. Add only intended context and task files explicitly (force-add if required). Never force-add member/runtime metadata, secrets, private rsi.config.json or credentials as part of context maintenance.

## Completion gate

- Canonical design accurately describes implemented behavior at every affected boundary.
- Canonical implementation context matches source, ownership, code paths and exact implemented usage.
- Parent coordination and child contracts cover the guarantees; no known contradiction remains.
- Relevant meaningful checks pass after final behavior-affecting edits, against the exact candidate.
- Task and test evidence are complete and carry full starting SHAs.
- Handoff states delivered changes, verification, starting/resulting commits and remaining limitations. No requirement to read intermediate updates to understand the result.

## Business data ownership

Each business system owns and aggregates its core in-memory schema, persistence schema, serialization, validation, migrations, queries and related data operations in one cohesive data-model part. Other systems interact through its public interfaces, including transaction-scoped operations when an existing guarantee spans owners. Do not create a central business-schema store or implement another system’s model in a caller. Agent owns its data model and persistence. Its execution mechanism can remain usable in memory as an implementation detail; that does not transfer persistence responsibility to Team. Core coordinates bootstrap/publication/reset through owner interfaces on one Storage transaction. Storage remains engine infrastructure with no business schema knowledge.
