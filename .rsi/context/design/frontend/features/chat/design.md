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
