# Agent

## Purpose, responsibilities and boundaries

Run one agent with supplied model settings, Harness capabilities and a continuous in-memory message context. Own the model/tool loop, message-context state, group-message consumption tracking, run status and produced execution values. A member's context outlives an individual activation.

Team owns group content and provides a read reference. Agent determines what shared messages it needs using its own tracking state. Agent does not own group publication, sender attribution, shared-message ordering, scheduling or SQL persistence. Team may persist Agent's exposed state; Agent must remain usable entirely in memory without a concrete Team or database dependency.

### Terms and public state meaning

| Term | Meaning and owner |
| --- | --- |
| Group context | Team's authoritative ordered user messages and accepted member final responses, with sender and mention information. |
| Group-context reference | A read capability supplied by Team; provides stable message identities, ordering and original shared content. It is not a caller-selected activation range. |
| Agent message context | Agent's ordered model-facing context containing incorporated shared messages and private assistant/tool/feedback messages. |
| Private working context | The private part of Agent context, including recorded execution information needed for continuity. |
| Group consumption state | Agent-owned information identifying which shared messages it has incorporated and which remain incoming. It is not derived from run success. |
| Stable history | Immutable completed execution/shared records served by Team, separate from mutable Agent model context. |

Exact field names and boundary encoding are implementation details. These semantic distinctions must remain observable through the public state contract used for persistence/restoration.

## Interface contract

### Run with a group-context reference

Accept model/tool configuration, the Agent's existing or restored context state, and a group-context read reference. Team does not supply a separate position indicating which messages to consume, which prefix a run processes, or which prefix a future compaction retains.

Agent queries the reference using its own consumption state, obtains a consistent ordered set of incoming messages, appends them once, and updates its own state in correspondence with incorporation. Reading a message alone does not mean it was incorporated. A first activation incorporates the available shared history; later activations extend the existing context rather than rebuilding it.

Group messages and private execution follow the timeline:

```text
Group messages
Private working messages
New group messages
Private working messages
...
```

Do not aggregate all shared messages into a new prefix at each activation. That reorganization is reserved for a future explicitly designed compaction mechanism.

### Sender and source identity

Each incorporated group message carries its stable shared identity, ordering and structured sender/mention data. Its model-visible text explicitly names the sender, including a stable sender identifier when available. Preserve Team's representation; do not infer the sender from the model protocol role. User messages and messages from different members can share a provider role without losing their actual authorship.

Preserve native image blocks and their order. Add sender text without generating an image description or converting image content into text. Private tool messages retain their protocol roles and call identifiers; sender decoration must not break tool-call/result pairing.

### Messages arriving during work

The reference can change while the model/tool loop runs. New shared messages do not enter the middle of active work. After the activation's current work finishes, Agent can incorporate the newly available shared messages through the same reference and its own tracking state. Such incorporation does not itself trigger another model call; Team's existing mention/admission rules determine activations. An idle member can receive shared-context synchronization without being activated.

Agent must not duplicate an already incorporated shared message when it next runs. For its own accepted final response, preserve both private origin and shared provenance while avoiding a second identical model-facing answer. A rejected candidate remains private; it must not be treated as a published group message. Exact reconciliation encoding belongs to implementation planning.

### Stop, restore and persistence

Run completion, failure or cancellation retains the Agent's assembled context and incorporated-group state. Do not erase successful private messages or reconstruct failed runs from a special retained range. Completed tool/assistant messages and recorded private feedback remain available on the next activation regardless of terminal status.

Expose detached context/consumption state and acknowledged changes to the caller. Team persists those public values and restores them together after restart. Agent defines their meaning; Team does not calculate a success boundary or choose history ranges for the next model request. A persistence failure cannot be reported as acknowledged durable context advancement.

Restart never replays model/tool effects. If interruption left a recorded tool call without a result, protocol repair must identify that uncertainty explicitly, without claiming no effects occurred or modifying stable history. Uncommitted stream chunks may be lost under the existing streaming contract.

An explicit user reset is a separate lifecycle operation that clears Agent context and consumption state consistently with Team group-history reset. It is not ordinary run finalization.

### Compaction boundary of this increment

The agreed future result is Team-owned group context followed by Agent-prepared private working context. Agent owns the relevant consumption/retention information and chooses the private information to keep; it does not summarize or rewrite Team's shared content.

Do not implement compaction preparation, a completion tool/signal, cutover mechanics, token-budget triggers or compaction-specific recovery in this increment. No automatic context trimming, run-success cleanup or backend-generated private summary is a substitute.

## Constraints, specifications and requirements

- No SQL schema, query, durable codec, runtime lease or Team concrete dependency in Agent.
- Stable history remains immutable when mutable model context changes.
- Preserve private execution boundaries, recoverable tool failures, cancellation and acknowledged durable hosting.
- The new path replaces per-run reconstruction/clear behavior; there must not be two competing retention mechanisms.
- Existing implementation documents remain useful files accessible through Harness tools, rather than the sole continuity state after success. This design adds no new retrieval policy.

### Acceptance examples

1. Agent incorporates G1, produces W1, stops successfully, then incorporates G2 on a later activation. Its context is G1 + W1 + G2, not G1 + G2 + reloaded summary.
2. The same example ending in failure still retains recorded W1. Run status does not select a different context-retention policy.
3. G3 arrives during work on G2. It is incorporated after that work finishes, once, without interrupting a pending tool interaction or automatically starting a new run.
4. Backend restart restores both the assembled context and Agent's consumption state. G1 and G2 are not reinserted and recorded tool effects are not replayed.
5. A member sees `Sender: Lead [member: <stable-id>]` in the group message content, not only in hidden metadata, even when the model protocol encodes it as a user-role input.
6. No compaction or summarization occurs merely because a run stops or a new activation starts.
