# Team

## Purpose, responsibilities and boundaries

A team belongs to one workspace and has two responsibilities: manage its members (create, configure, retire) and coordinate their work. The user and all active members participate in one shared group chat; a lead helps maintain the user design, decomposes work, forms the team and assigns it through shared responses.

The team owns member identity and lifecycle, the member change workflow (edit → validate → user commit → separate user activation), member model settings, work admission and routing, and private-history inspection. The model loop belongs to the runtime, tool authority and rules to the harness, conversation construction to the conversation-context system, the shared transcript and routing mechanics to the group chat, and durable design content to the context base. Members exist only inside their team: they never appear in the global agent list and never accept direct agent-run input.

## Interface contract

**Purpose and supported interactions.** A user lists a workspace's active team, opens one member's active configuration and effective harness, edits member files with the lead, reviews the active-to-current difference, activates a reviewed committed configuration, and adjusts a member's model settings. Members are triggered by shared chat messages and by accepted final responses that mention them.

**Required inputs and returned information.** Member files carry name, role, responsibility, `settings`, `promptFiles`, `designScope` and `execute`; identity, revisions and format bookkeeping are backend-owned. Activation accepts only `{revision, digest}` from a prior inspection. Model settings accept `{revision, value}` with `connectionId`, `modelId` and `modelOptions`. Reads return the roster with readiness/running state and derived implementation scope, the active member record with exact source and effective rules, the current-versus-active comparison with pending and commit status, and the member's private history.

**Observable effects.** Activating a reviewed change set atomically inserts new member conversations, updates stable source and settings, and retires deleted members while preserving their history and files. Member creation initializes the member's conversation in the same transaction. A member run consumes shared context, executes through its harness in the shared workspace and publishes a final response back to the group. Member-file acceptance never activates settings by itself.

**Failure behavior and lifecycle.** Forbidden update fields (name, role, model, design assignments), lead deletion, duplicate active names, unsafe or missing prompt references and unknown fields refuse the whole change set. Activation requires the entire workspace team to be idle, including admitted runs and finalization; busy, stale or invalid activation changes nothing and preserves the previous team. There is one unretirable lead and unique active names per workspace. Retained private histories, ordered shared messages and sequential workspace execution are guaranteed.

## Constraints, specifications and requirements

- At most 20 members per team. Updates may change only execution rules, supplementary prompts and responsibility; any other field requires an explicit create/delete replacement proposal.
- Every member's authority derives from accepted design mappings; a working/dependency assignment grants writable or read-only implementation context and source paths respectively, and pending design edits grant nothing.
- Effective member settings resolve like a solo agent's run settings, with the member record's revision as the snapshot's agent revision.
- Only one member executes per workspace at a time, including admitted and finalizing work.
- Activation is a user operation gated on a separate user commit; committal alone does not change the roster, and activation never triggers a run.
- Explicit conversation reset clears the workspace's shared and private conversation state while preserving members, settings, models and project/context files.

## Subsystems

- [Group chat](group-chat/design.md) — shared transcript, mentions and routing, mention budget, response reservations, images, reset and backend operations.
- [Conversation context](conversation-context/design.md) — per-member working-context assembly, implementation-readme entry points, automatic retrieval and failure retention.
- [Lead](lead/design.md) — the lead's design-maintenance and assignment responsibilities and the user approval boundary.
