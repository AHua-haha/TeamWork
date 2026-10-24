# Continuous member context

## Status

Delivered in this task commit. Canonical design/implementation context and source are reconciled; compaction remains deferred.

## Provenance and safeguards

- Task ID: `2026-10-24-continuous-member-context`.
- Starting commit: `2efa38da6a75a1b0c27109da46bc767423e5aedf`.
- Branch: `codex/lead-harness`.
- Prior local change: `.gitignore` housekeeping; preserve separately.
- Review boundaries: Core coordination, Agent context ownership and Team group-context/persistence responsibility.
- The initial increment wrote drafts only. The implementation changes source/canonical context and tests; it does not operate on live databases, registered workspaces, deployments, provider settings or credentials.

## Agreed outcomes

1. Team owns authoritative group context and passes only its read reference to Agent; no caller-selected consumption or compaction position is passed alongside it.
2. Agent owns its context and tracking of incorporated group messages. It obtains the incoming messages it needs through the reference.
3. Context extends chronologically across activations and terminal outcomes; do not clear it after success or rebuild it from implementation documents and failed-history ranges.
4. Group sender identity appears in model-visible message content in both shared and Agent context, alongside structured sender metadata.
5. Group messages remain shared and consistently ordered; private execution stays private. Incoming group messages do not interrupt active model/tool work.
6. Team persists Agent's exposed state and restores it after restart without deciding the meaning or advancement of Agent-owned boundaries.
7. Future compaction will preserve Team ownership of group content and Agent ownership of private continuation information. Compaction preparation, replacement mechanics and trigger policy are deferred.

## Drafts

- [Core coordination](drafts/design/backend/core/design.md).
- [Agent](drafts/design/backend/core/agent/design.md).
- [Team](drafts/design/backend/core/team/design.md).

## Delivered implementation

- AgentMessageContext owns incoming-group selection, incorporation/provenance markers, own-final reconciliation and interrupted-tool repair. AgentExecution synchronizes before and after work, retaining all recorded private context across terminal outcomes.
- Team supplies only a GroupContextReference through policy. TeamData reads original group inputs in a repeatable-read transaction; context CAS acknowledges entries and Agent-owned consumption together.
- TeamRuntime restores once after execution admission. TeamRunner notifies idle members without activation; a final idle catch-up closes the message-arrival race at the end of busy work. Idle synchronization failures are observable and retryable without rejecting an already-accepted publication.
- Sender text appears in group entries and incorporated member inputs. Own accepted answers gain provenance/attribution once while original signed blocks, including leading thinking blocks, remain intact. Stable history is unchanged.
- Removed Team-side ConversationContext document parser/executor, per-activation reconstruction, processed/success boundary tables and terminal context clearing. Implementation documents remain maintained project artifacts; their reserved retrieval section is not automatically executed. No replacement retrieval strategy was added.
- Added a backend-only context_format migration marker. Existing member recorded history is adopted once through Agent's public procedure; call/result pairs stay together and old context-only missing results are regenerated once. Adoption and its marker commit atomically. SQL default changes recover after interrupted migration. Obsolete retention tables are retired, preserving messages/project files.
- Updated canonical Core/Agent/Team contracts, owned implementation references, README and Harness instructions. HTTP/SSE envelopes, scheduling, review, tool permissions and public stable history stay compatible.

## Verification

Full commands/results, including initial failures and corrected reruns, are in tests.jsonl. Final candidate gates cover:

- 198 backend unit/HTTP tests: ownership, request chronology, acknowledgements, private/signature preservation, reset, tool/harness behavior and source boundaries.
- 69 disposable MySQL integration tests: success/failure continuity, actual runtime restart, interrupted-tool recovery, legacy schema adoption/idempotence, queued input selection, idle synchronization failure/retry, late-message race, stable history, image hydration and reset.
- Backend typecheck/build, 12 canonical RSI node/format/mapping/link checks, compiled startup/prompt assets and candidate whitespace.

The new race test initially paused an unrelated idle reader and timed out; the fixture now targets the backend terminal read using its lifecycle hook. This was a test-control error, recorded alongside the failed run. Original old-retention assertions and stale parser imports were updated to the new contract; failed intermediate runs remain in evidence.

## Remaining scope and limitations

- Compaction preparation, completion signal/tool, cutover, trigger/budget policy and compaction-specific recovery remain deferred.
- Team group summarization, structured extraction and member-specific views remain deferred; shared messages are original content now.
- Context grows until an explicit future compaction mechanism is designed. One-time adoption may restore more recorded private work than the old per-success strategy retained.
- Backend startup applies the migration when the new code is used. No real workspace/database was migrated or reset by this task, and no paid model calls were made.
- Prior unrelated .gitignore housekeeping remains outside this task commit. No merge, push or deployment is included.
