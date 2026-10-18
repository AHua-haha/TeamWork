# Optional agent response mention header

Status: complete
Task start commit: 50d34eaa4e67ff064e84a5215374a159827e8949
Review boundaries: group publication/routing, stable final references and group-chat presentation.

## Design outcomes
- [delivered] Agent routing comes only from an optional leading <mentions> block containing a JSON array of member names. Missing/empty/[] selects nobody; the body is ordinary Markdown regardless of @ text.
- [delivered] Validate header syntax and recipient eligibility atomically, with existing private refusal/retry behavior and no partial publication.
- [delivered] Display/deliver only the response body while retaining raw private history and exact final source references, including reload/streaming and older publications.
- [delivered] Persist file-backed agent cooperation rules and examples.

## Decisions and open questions
- Scope is agent responses, as discussed. User composer @Name/@{Name With Spaces} input and default lead routing remain available.
- Accept leading whitespace before an exact case-sensitive <mentions> opening; only that first block has routing meaning. Blank block and [] both mean no recipients. Deduplicate names case-insensitively. Require a nonempty body.
- A malformed reserved opening/header is refused privately; headers elsewhere are ordinary body content. No fallback body scan, Markdown-specific exceptions or text deduplication.
- Stable final references will record a backend-owned body offset in selected final text; missing offsets retain older accepted text unchanged.

## Checkpoints and remaining work
- Delivered optional header routing, atomic refusal/retry, stable body-only final references, streaming presentation and file-backed cooperation instructions. Canonical contracts and implementations match the completed drafts.
- Raw private assistant history remains unchanged. Backend-owned UTF-16 body offsets identify the shared body; older accepted references preserve their original text.
- Verified 143 backend tests, 49 disposable MySQL integration tests, 67 frontend tests, both builds, packaged prompt loading from another working directory, and desktop/mobile browser streaming/folding/reload behavior. See [test evidence](tests.jsonl).
- Restarted the idle local backend and verified the existing workspace timeline was unchanged; no model calls were made.
- Browser reproduction uses [fixture](browser-server.mjs) and [checks](browser-check.js); screenshots are local ignored artifacts under output/playwright/.
- All agreed behavior is complete in this feature-branch checkpoint. No remaining design decision. No push/merge requested.

## Review links
- [Draft group-chat contract](drafts/workspace-agent/team/group-chat/design.md)
- [Canonical group-chat contract](../../systems/workspace-agent/team/group-chat/design.md)
- [Canonical frontend contract](../../systems/frontend/group-chat/design.md)
