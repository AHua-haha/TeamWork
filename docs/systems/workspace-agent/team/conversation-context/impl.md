# Conversation context implementation

## Contract

[Design](design.md): authoritative group context, document result context and Bash retrieval, durable failed working ranges, successful cleanup without history deletion.

## Responsibilities and decomposition

Conversation context parses assigned implementation README documents and runs retrieval through the existing Bash tool. MySqlStore owns admission snapshots, per-member processed group/successful-history boundaries and immutable private history. TeamSystem initializes context once before the first model step. AgentRuntime remains the single loop.

## Coordination and data flow

Admission stores an immutable group upper bound and private history start. Preparation loads group records through that upper bound, splits at the prior processed group boundary, and inserts document text plus failed history before new group messages. Retrieval results are recorded private user messages. Runtime private messages append normally. Terminal publication/failure updates the processed group boundary and successful-history boundary in the same SQL transaction as run completion. Clearing a successful context removes only model-context references; immutable messages remain. Restart recovery completes abandoned runs through this same terminal path.

## Decisions and constraints

One selected document per assigned working node, impl/README.md, normalized lexical order; references in lookup tables are not loaded. Exact designated sections and JSON command configuration; ordinary Bash inputs/outputs and authority. Recoverable diagnostics permit file repair. Missing tool results become context-only error messages; never replay commands. Existing private streaming deltas remain transient. No per-member shared-message delivery copies or compatibility loop.

## Code map

- [Conversation context](../../../../../backend/src/conversation-context.ts): document parser, interrupted-exchange repair and run preparation.
- [Database](../../../../../backend/src/database.ts): durable boundaries and context composition.
- [Team policy](../../../../../backend/src/team-system.ts) and [runtime](../../../../../backend/src/runtime.ts): initialization hook and recorded retrieval input.
- [Implementation rules](../../../../../backend/prompts/harness/implementation-context.md): template and maintenance rules.

## Verification

Parser tests cover fenced examples, lookup non-expansion and full Bash inputs. MySQL/runtime tests cover ordered composition, failed chains, success cleanup, reopen/restart interruption, retrieval errors, cancellation and reset. Existing group publication, harness, stable history and frontend builds remain required gates.

## Durable boundaries

member_contexts.group_position is the previous processed shared prefix and success_position is the private-history exclusion boundary. member_context_runs freezes group_through/history_after on publication and prepared on context initialization. prepareMemberContext reads retained private messages directly from messages using (success_position, history_after]. Terminal writes update the processed prefix and clear the live assembled context; success advances the exclusion boundary. Both terminal entry completion and these updates share one transaction. Reset deletes admission rows before runs and resets boundaries. Migration initializes missing member state from prior completed successful runs and leaves old project documents untouched.

## Prototype repair policy

Missing/invalid documents generate private context diagnostics, with no retrieval from that document. Parsing validates the complete commands array with parseBashInput before execution. Recoverable invocation errors are recorded private user input and allow the model to repair. Store/ownership failures remain terminal. repairInterruptedTools adds only missing results to constructed context; no completed stable record is changed. The module consumes accepted canonical working-design paths for casing/authority, then reads the current shared README bytes. No recursive lookup-target reading or source-code preloading remains.

## Image attachment integration

During prepareMemberContext, shared user attachment references are loaded from chat_images through the same SQL transaction. groupEntry builds a user content array containing the existing author/recipient-prefixed text followed by ordered ImageContent; text-only entries keep their existing string representation. Summary/retrieval/private-history ordering and boundary semantics are unchanged. No caption generation or file lookup expansion is introduced. The team request policy checks image input capability against the final constructed messages before invoking a provider.
