# Frontend group chat

Status: complete; backend and frontend contract implemented and verified for the commit candidate.

Task start commit: ad27b9630c7332782658d7a21b116b43c6b88a22

## Review boundary

The workspace frontend: shared transcript, mention-based submission, member activity and failure status, group stop, and integration with current design/team/file views. Solo conversations retain their existing contract.

## Intended outcomes

First clarify the existing backend from its frontend consumer's perspective. Design the UI against that contract, record the proposed frontend design and implementation in task drafts, then implement the agreed UI. Keep canonical frontend documents describing committed behavior until the implementation checkpoint.

## Progress

Inspected group records, chat routes, publication and follow behavior, database history/status reads, private agent routes, and existing workspace/config clients. Recorded the implemented backend interface in [backend API contract](backend-api.md). That initial review preceded implementation; delivered behavior and verification are recorded below.

## Agreed main chat presentation

- Every member's accepted final response is displayed completely as rendered Markdown, using the full available chat content width.
- User messages are positioned on the right-hand side of the chat.
- Member response sections have no surrounding bubble, card, tinted background or permanent avatar column.
- A compact sender header at the start of each section uses avatar, member name and member color to identify the author. The response body keeps a neutral appearance and full width.
- The member's internal working messages are folded by default, following the supplied Codex screenshots: an unobtrusive duration/disclosure row above the final response; expansion exposes working messages and tool activity.
- Private execution inspection is a user presentation feature. Working records are read separately from the member run API, never published into the shared transcript or delivered to colleagues.
- Accepted activation immediately reserves the member's response section in the timeline. Its folded work updates there; its accepted final response fills that same section. Later messages and different completion orders do not relocate it.
- Reservation order must be persisted by the backend and shared across clients/reloads. The current final-publication cursor remains a separate synchronization concern. Required backend changes are recorded in [reserved response contract](reserved-response-contract.md).
- The agreed durable group history that stores user input directly and references member final responses in immutable agent message history, together with the corresponding private working-message range. Reserve the member entry at activation; finalize its reference/range on completion. This is implemented in the settled response contract.
- The main presentation draft is [Workspace group chat](drafts/frontend/group-chat/design.md). Implementation has not started.

## Settled defaults

Right-side user bubbles use subtle backgrounds and left-aligned text. Composer @ suggestions show availability; server admission remains authoritative. Refused sends preserve the draft/reference and show an inline reason. Member model settings live in Team. Terminal failure/cancellation/interruption preserve response sections and inspectable work without a fake final. A chat-level Stop stops current team work. Current Design, Team and Files remain; design versions are deferred.

The storage/read separation is conceptual guidance, not a requirement for a broad runtime refactor. Implementation uses persistent response entries and an independent change cursor. New activations reserve positions atomically with admission. Existing prototype history is imported in original publication order, since old records did not reserve response positions.

## Checkpoint and verification

Delivered durable reservations, validated final references, terminal working ranges and replayable updates; integrated group UI, private folded inspection, per-member settings, mention suggestions, refusal recovery and group stop. All agreed UI defaults are implemented. Historical backend-api.md and reserved-response-contract.md remain discussion records; accepted drafts and canonical documents describe the delivered behavior.

Verification: backend unit/HTTP tests, frontend client/projection tests, disposable MySQL integration, both builds and canonical/draft/link/whitespace audit. Browser review used the controlled API fixture (no paid model calls) for desktop/mobile layout, disclosure, settings, refusal, immediate reservations, stop and reload ordering. tests.jsonl includes repaired environment/schema/test-fixture failures as well as passing runs. No remaining design decision; review this feature branch before an authorized merge. The task starts at ad27b9630c7332782658d7a21b116b43c6b88a22; the Task-ID trailer identifies the resulting checkpoint.
