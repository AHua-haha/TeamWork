# Increase default model-call limit

Status: complete
Task start commit: c4c326ed4a0824c233fbde03d6c308b0af9d4f4e
Review boundary: [Agent runtime](drafts/agent-runtime/design.md).

## Design outcomes

- delivered: increase the default maximum model calls per member/agent run from 32 to 64.

## Decisions and open questions

The user requested 64. Preserve explicit constructor overrides, step counting and existing exhaustion behavior. This changes the runtime default, not the separate mention or token limits. No unresolved choices.

## Checkpoints and remaining work

Updated the runtime default, canonical design/implementation documents and backend README. TypeScript compilation passed. Loading the new default requires restarting the backend or updating the deployment. Existing integration coverage already verifies configurable exhaustion; no new implementation-mirroring test is needed for this numeric default adjustment.
