# Chat

## Purpose and responsibilities

Chat owns the user-facing conversation workflow: selecting the available conversation context, composing and submitting messages, displaying stable history and live progress, and exposing supported cancellation and error/retry states.

## Interface contract

Chat uses the shared backend client for history, message submissions and SSE progress. It owns chat-specific state and presentation merging. Stable backend records are authoritative; transient stream deltas are not treated as completed stable history until confirmed by backend records. A browser disconnect or navigation does not itself cancel backend execution.

**Input:** workspace/conversation identity as required by existing APIs, user text/images, history/cursor data and stream events.

**Output:** conversation UI, explicit submission/cancellation actions and visible progress/failure states.

**Effect:** browser chat state and user-authorized backend requests; it does not own agent scheduling or execution policy.

**Usage example:** the user submits a message; Chat renders the reserved/progress area from SSE, then reconciles with completed history and preserves editable input on supported refusals.

Exact route paths and whether Chat requires an explicitly selected workspace are to follow the current interaction/API contract; this design does not create a new conversation lifecycle.

## Lightweight workspace roster

The temporary workspace mode supplies Chat with roster identities and live running flags, without requesting effective harnesses or readiness evaluation. Mentions remain available; unknown readiness is not represented as validated readiness. Backend admission decides whether a mentioned member can run. Refresh the cheap roster on initial load, shared timeline changes, model preference saves and member activation; do not use a periodic full team inspection. Model hover controls, streaming, stop/reset, pictures and commit approval remain available.

## Bounded history and recovery

Open with the latest 50 group timeline entries and follow changes after that snapshot's update cursor. Offer explicit older-history loading by before-position; retain loaded older pages across refresh/reconnect and preserve the scroll anchor when prepending. Group final-response history and private working history load separately. All terminal runs start folded, including unsuccessful runs; fetch private records when expanded. Running responses still follow private output.

Apply changes by entry identity and revision and advance the update cursor only after successful application. Ignore duplicates. Updates to unloaded older entries advance the cursor without loading those entries. Reconcile live updates arriving during an older-page read so stale page data cannot replace newer state. Manual refresh and ordinary error recovery preserve current content and resume from the recorded cursor. Only explicit reset or a backend-declared invalid/expired cursor permits replacing the loaded view with a fresh latest-50 snapshot; never load all history as recovery.
