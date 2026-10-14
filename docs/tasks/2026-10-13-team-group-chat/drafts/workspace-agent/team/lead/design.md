<!-- Task proposal; current contract is under docs/systems/ -->
# Lead agent

## Purpose and boundary

The lead is the default recipient for unmentioned user messages in the workspace group chat. It helps create, update, and clarify the project's design and subdesigns, forms the team, configures member harnesses, and assigns work based on that design. The design is the shared agreement between user and agent; durable design identity is independent of member identity.

## Inputs and preconditions

The user chooses the lead's model and posts messages to the shared workspace chat. The lead may discuss alternatives in its reply and wait for the user's answer before resolving unsettled design choices. No separate approval screen is required for changes already discussed.

A design file in user context is a JSON object with Markdown `content` and `implementation`, a list of up to 50 distinct workspace-relative implementation files or directories. `.` maps the project root; `.git` and `.context` cannot be implementation mappings. Ordinary context path and text-size limits apply. Subdesigns use separate files, for example `user/design/backend.json`; content can explain their relationships.

The lead has these operations in addition to team management and harness tools:

| Tool | Input | Result |
| --- | --- | --- |
| `read_design` | `path` in user context; optional `.context/` prefix | Raw current file, revision, author, reason, parsed design or a design issue |
| `save_design` | `path`, complete `content`, complete `implementation`, `baseRevision` or null to create, nonempty `reason` of at most 1,000 characters | Status, path, revision, sequence, created flag, exact before/after file content, reason, parsed design |
| `configure_harness` | `to` member name, complete `harness` | Updated member and revision; model settings preserved |

A harness contains `designScope: {working: [design paths], dependencies: [design paths]}` and `allowedCommands: [rules]`. Each design list has at most 50 distinct existing user-design files and cannot overlap the other list. Each command rule is `{kind: "exact", argv: [executable, ...arguments]}` or `{kind: "executable", executable: "name-or-path"}`; there are at most 50 rules. Working design and all dependency material are read-only; only working implementation is editable through file tools. The lead may configure its own harness, including its implementation writes, without changing its model.

An assignment is a final group response mentioning one or more configured workers, with their objectives and expected results. Recipient readiness and harness scope are validated by the team's publication mechanism. Workers run independently; the lead ends its assignment response and can be mentioned again by a worker.

## Outputs and observable effects

- A discussed design change updates content and implementation mapping together, with revision protection. Its exact previous and resulting file content and reason appear in the lead's tool result. The instructions require the lead to explain the change in its reply; conversation text remains model-generated.
- Context history and change feeds attribute the save to `{type: "lead", memberId, runId}`. A byte-identical save returns unchanged with no new sequence or version.
- The lead creates, configures, updates and retires workers through team tools. These changes do not remove their design files or implementation.
- Accepted assignments trigger mentioned workers under their harnesses. All members receive their final reports through shared messages; private member work is not shared. The lead retains its own private history and explains design changes in its accepted group response.

## Failure behavior

Wrong role, invalid input, missing or invalid design, stale revision, unavailable configuration, or an invalid assignment is refused explicitly. Expected refusals are normal tool results so the lead can recover. A stale save changes nothing; the lead must reread and discuss a changed intention before retrying. The read operation exposes invalid raw records for repair. A worker cannot invoke lead operations. Storage failures can fail the run. Stopping the group exchange cancels active branches; completed writes remain.

## Guarantees and limits

Design edits pass through a dedicated, visible tool operation. Generic file tools cannot change designs or harness context. The lead has broad read access to help inspect the workspace; ordinary implementation writes require its own configured working design. Discussion and explanation requirements guide model behavior and do not constitute an approval gate.

This prototype uses shared group messages, parallel activations and retained private member histories. Automatic harness-context maintenance, automatic design decomposition, structured choice UI, and filesystem confinement of permitted commands are deferred. The model decides how to decompose work and propose choices using the supplied tools and instructions.

## Acceptance examples

1. The user chooses a backend design. The lead saves `user/design/backend.json`, shows its exact change and reason, and explains the resulting design.
2. The lead creates Backend, configures working backend and dependency API designs, and assigns implementation. Backend edits backend implementation, reads the API, and returns its report.
3. The user edits the design after the lead reads it. Saving the old revision is refused and preserves the user's edit.
4. A member proposes a design change in its report. The lead discusses it with the user, then saves the discussed design; the member never edits it directly.
