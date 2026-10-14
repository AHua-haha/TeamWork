<!-- Task proposal; current contract is under docs/systems/ -->
# Lead agent implementation

## Contract

[Lead design](design.md). Preserve revision-guarded, attributed design changes and independent member harness configuration.

## Responsibilities and composition

LeadService owns role-checked design read/save and harness configuration. It uses [design parts](../../context-base/design-parts/design.md), [harness](../../harness/design.md) and parent [team](../design.md) contracts. Lead tools expose those capabilities. The lead assigns work through accepted shared final responses; the [group chat](../group-chat/impl.md) admits recipients and runs them independently.

## Coordination and data flow

Save validates revision and reason, delegates record encoding to DesignService and persistence to ContextBase, and returns exact before/after content. Read uses inspect to expose malformed records for repair. Configure resolves design references before revision-guarded member update and preserves settings/identity, including when configuring the lead itself. Every worker model request is prepared independently through its harness.

## Decisions and constraints

Design awareness uses attributed history/change feeds, exact private tool results available for inspection, and instructions to explain changes in the final shared response. No approval-token state exists. Assignments use objectives, mentions and configured design scope; there is no blocking assignment tool or separately copied assignment scope.

## Code map

- [Lead coordination](../../../../../backend/src/lead.ts)
- [Lead tools](../../../../../backend/src/lead-tools.ts)
- [Parent team implementation](../impl.md) owns lifecycle and role instructions.
- [Group chat implementation](../group-chat/impl.md) owns publication and triggering.
- [Design parts implementation](../../context-base/design-parts/impl.md) owns record encoding and persistence delegation.

## Verification

[Lead tests](../../../../../backend/test/lead.test.ts) cover exact changes, attribution, unchanged saves, stale revisions, worker refusal and own-harness configuration. [MySQL integration](../../../../../backend/test/integration/backend.test.ts) drives save, create, configure, shared assignment, scoped write, command and return mention through the real runtime, checking author persistence after reopening storage.
