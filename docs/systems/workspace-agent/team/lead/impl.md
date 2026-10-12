# Lead agent implementation

## Contract

[Lead design](design.md). Preserve user-visible, revision-guarded changes and assignments derived from configured designs.

## Responsibilities and decomposition

`LeadService` owns role-checked design maintenance, dedicated harness configuration, and preparing design-based assignments. It uses the neighboring [design parts](../../context-base/design-parts/design.md), [harness](../../harness/design.md), and parent [team](../design.md) contracts. `leadTools` exposes these actions to the runtime. Member lifecycle stays in TeamService; execution and chain cancellation stay in TeamRunner.

## Coordination and data flow

Save validates the reason and revision, asks DesignService to encode content and implementation mapping, and uses the context base's attributed save. Tool results include exact before/after content and parsed design. Read uses inspect so malformed existing files can be repaired.

Configure resolves all design references before updating the member at its current revision and preserves its settings and identity. It may target the lead itself. Assignment resolves the recipient harness, requires a nonempty design scope, constructs references from current designs, validates total message length, and delegates to TeamRunner.call. The next recipient model request is independently prepared by the harness.

## Decisions and constraints

Design awareness is provided by an explicit tool result, change feed, history attribution, and instructions to explain changes. There is no approval-token state. Choices use conversation text. Assignment references belong to the configured harness, avoiding a second assignment scope that can disagree with file permissions. No old agent-context scope is used.

## Code map

- [Lead coordination](../../../../../backend/src/lead.ts)
- [Lead runtime tools](../../../../../backend/src/lead-tools.ts)
- Parent [team implementation](../impl.md) owns member lifecycle, working instructions, and call scheduling.
- [Design part implementation](../../context-base/design-parts/impl.md) owns record encoding and persistence delegation.

## Verification

[Lead tests](../../../../../backend/test/lead.test.ts) cover visible exact changes, attribution, unchanged saves, stale revisions, worker refusals, own-harness configuration, design-based assignment, reports, and cancellation. [MySQL integration](../../../../../backend/test/integration/backend.test.ts) drives save, create, assign, scoped write and report through the real runtime and verifies author data after reopening storage.
