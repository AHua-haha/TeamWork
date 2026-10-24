> Behavior reference inside Team implementation context; Agent and Team canonical designs govern ownership.

# Continuous conversation context

Team owns original shared user/final messages and provides a read reference. Sender identity appears in model-visible message content and structured metadata. Agent owns its continuous message context and incorporation state, selects incoming messages through that reference, and appends them before work or after it finishes. Context remains interleaved across activations; there is no per-activation regrouping or reconstruction.

Successful, failed, cancelled and interrupted work retain recorded private context. Team persists Agent public snapshots and restores them after restart. Stable shared/private history is independent of mutable model context. Own accepted finals are reconciled with their private origin so the model sees their answer once, with sender attribution. Refused candidates remain private. Missing interrupted tool results get explicit uncertainty diagnostics without replay or history rewriting.

Idle group synchronization starts no model call. Busy/queued members synchronize at the execution boundary. Mention/admission limits, sequential shared-workspace execution, image semantics, final reservations and HTTP/SSE presentation remain unchanged. Explicit idle reset clears shared history, Agent context and incorporation markers together, preserving project documents.

Implementation README files remain ordinary maintained project artifacts. Neither their summary/lookup text nor their Automatic retrieval entries are automatically loaded/executed. Agent may read files and run Bash using existing tools. There is no separate retained-failure range, success-only cleanup or terminal context clearing.

Future compaction will combine Team-provided group context with Agent-prepared private continuation. Compaction preparation, cutover and trigger policy, Team summarization/structured extraction and member-specific group views are deferred. No automatic trimming or backend private-summary policy substitutes for them.
