# Chat image attachments

Status: complete
Task start commit: c0d19b4badb2bbfc33ff30ed48a1cd47e552ae54
Review boundaries: [Group chat](drafts/workspace-agent/team/group-chat/design.md), [Frontend](drafts/frontend/group-chat/design.md)

## Design outcomes
- delivered: durable user image attachments, Pi preparation and native multimodal working context.
- delivered: composer file picker, clipboard/drop, removable previews and persisted image display.

## Decisions and open questions
Reuse Pi public resizeImage; no semantic caption generation or separate model call. Keep custom runtime. One multipart submission carries text and images atomically; JSON remains the text-only representation. Four PNG/JPEG/WebP images, 10 MiB source each; prepared images at most 2000 pixels per edge and 5 MiB. SQL stores prepared binary once with workspace-scoped IDs; history/feed carry references. Reset removes attachments. Non-vision models fail explicitly. No open behavioral decision.

## Checkpoints and remaining work
Implemented backend first, then frontend; promoted all 12 drafts with the completed code. Pi public convertToPng/resizeImage handle preparation; no private helper imports, captioning model, new dependency or runtime-loop branch. SQL transaction stores prepared binary once and shared metadata references. Fixed-context construction hydrates native images. Model capability checks cover admission and subsequent requests. JSON text submissions and existing stream protocol remain.

Final verification: 189 backend tests, 65 disposable MySQL integration tests, 86 frontend tests, backend and frontend builds, document parity/link/public-import audit, and desktop/mobile browser review. All runs including failures are recorded in tests.jsonl. Initial unit failure came from evaluating an irrelevant mocked model field for text-only context; image detection now precedes capability inspection. Browser fixture was updated to protocol v2 and requested-run identity; navigation overlay and relative verification URL issues required test correction only.

Browser fixture: browser-server.mts uses actual upload preparation/routes and in-memory storage; real SQL reopening/native content are checked by integration tests. Provider calls are captured rather than paid external vision requests. The existing frontend chunk-size build warning remains. No live workspace data, provider settings or running user backend was reset. Pre-existing untracked .claude/ and .DS_Store files preserved. Restart backend to apply the additive chat_images migration; select an image-capable member model.

No remaining design decision or task work. No push or merge requested.
