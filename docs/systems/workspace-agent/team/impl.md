# Team implementation

## Contract

[Team design](design.md). Preserve team identity and lifecycle, readiness, sequential noncyclic calls, and design-based work supplied through member harnesses.

## Responsibilities and decomposition

The [lead child](lead/design.md) owns user design maintenance and assignment preparation. The neighboring [harness](../harness/design.md) owns tool authority and file context; [context base](../context-base/design.md) owns durable records; [workspace](../workspace/design.md) owns registration and files; [runtime](../../agent-runtime/design.md) owns agent execution.

TeamService owns member records, validation, initial lead, lifecycle and readiness. TeamRunner owns calls, active state and cancellation. MemberContext owns cooperation/role instructions and roster. Team tools expose messaging and lifecycle. TeamSystem composes these with LeadService and HarnessService and adapts runtime requests.

## Coordination and data flow

A member record stores identity, responsibility, harness, settings and lifetime state. MySQL creates its conversation transactionally, enforces unique lead/name keys, and guards updates by revision. Workspace creation includes newLead in its transaction. Startup migrates records lacking harness to an empty harness, discarding old scope; it then adds a missing lead. No runtime legacy-scope fallback exists.

Readiness combines ConfigService settings checks with nonempty worker scope, resolvable DesignService records and empty catalog tools. teamRunConfig validates readiness before accepting a run and then resolves the model snapshot. Solo agents retain the config path.

At each request TeamSystem policy replaces member tools with HarnessService.prepare, passing role-eligible team/lead tools. MemberContext adds current identity, roster and cooperation rules to the snapshot standing instructions; harness adds current design/file context. Solo requests are unchanged. The harness checks current access again during tool execution.

User input enters TeamRunner.startUser, which refuses workers and records a lead chain. A call validates text, name, busy/readiness and chain membership/depth, starts the recipient with caller prefix, links cancellation, waits for runtime.finished, and reads finalText. Reports truncate at 20,000 characters. Cancellation propagates down calls; failures return normal reports. Retire marks the record before cancelling its active run. There is no queue or resumption.

## Decisions and constraints

Keep persistent conversations but independent design references. Model settings stay run snapshots; harness authority is current per operation. Expected AppError refusals return normal tool text via shared tool-result helpers, while storage errors propagate. Members use harness tools only; catalog tools could bypass scope and are therefore a readiness issue. Existing sequential cooperation is retained as the prototype mechanism.

## Code map

- [Team records/service/run config](../../../../backend/src/team.ts)
- [Call scheduling and cancellation](../../../../backend/src/team-runner.ts)
- [Role and cooperation instructions](../../../../backend/src/member-context.ts)
- [Team tools](../../../../backend/src/member-tools.ts) and [shared normal tool results](../../../../backend/src/tool-result.ts)
- [Composition and runtime policy](../../../../backend/src/team-system.ts), [HTTP routes](../../../../backend/src/team-routes.ts)
- [Lead implementation](lead/impl.md), [harness implementation](../harness/impl.md), [database implementation](../../database/impl.md) own their respective code.

## Verification

[Lifecycle tests](../../../../backend/test/team.test.ts), [call tests](../../../../backend/test/team-calls.test.ts), [request tests](../../../../backend/test/team-context.test.ts), and [HTTP tests](../../../../backend/test/team-routes.test.ts) cover identity, revisions, readiness, migration, role tools, sequential call boundaries and cancellation. [MySQL integration](../../../../backend/test/integration/backend.test.ts) checks store uniqueness/conversation exclusion and the full design-save/worker/assignment/report workflow. [Harness tests](../../../../backend/test/harness.test.ts) and [file tests](../../../../backend/test/member-files.test.ts) verify the authority required by team requests.
