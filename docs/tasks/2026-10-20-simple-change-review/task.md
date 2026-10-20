# Simple design/member change review

Status: complete
Task start commit: 921a8762d831b5dcbea6dffe8b1836b57fdffe34
Review boundaries: frontend Changes tab, team review API and harness protected-scope review.

## Design outcomes

- [delivered] Compare current design/member files directly with each scope's last user-approved commit; include added/untracked, modified and deleted files without changing staging.
- [delivered] Reuse fixed management scopes rather than resolving the whole team/harness for review. Batch Git operations and preserve exact reviewed revision/base approval safety.
- [delivered] Load one small Changes response. Member activation remains separate, with committed validation independent of pending-file loading.
- [delivered] Coalesce frontend reads, retain the last successful view and never invalidate a result merely because a polling tick arrives.

## Decisions

- The approved scope reference is the baseline, not an automatic checkpoint or native project HEAD.
- A lightweight immutable review snapshot may retain the reviewed bytes for existing exact-revision approval; it does not change accepted refs or agent/project staging.
- Read approval/active member revision status cheaply. Validate committed member configuration separately only when it differs from active; it must not delay file display. Approval and activation rules remain unchanged.
- Keep the comprehensive configuration inspection API for its existing callers, but remove it from Changes loading. No new write/activation shortcut is introduced.
- Existing unrelated untracked .claude/ and .DS_Store files are preserved. Diagnostic scripts stay ignored under .run/.

## Checkpoints and remaining work

Delivered in one consistent checkpoint on `codex/lead-harness`; no remaining design decisions. The [harness](../../systems/workspace-agent/harness/design.md), [team API](../../systems/workspace-agent/team/design.md) and [frontend](../../systems/frontend/design.md) canonical contracts match the retained task drafts.

- `GET /workspaces/:workspaceId/team/changes` returns the two protected-scope file reviews and approved/active member references. It does not reconstruct or validate full member configuration. Committed-member validation runs independently only when approval differs from activation.
- Batched file hashing and combined Git patches retain immutable reviewed bytes, added/untracked/deleted/binary/mode changes, isolated staging, and stale revision/base refusal. Invalid pending files remain reviewable.
- Frontend coalesces overlapping reads and retains its previous successful view. Separate design/member approval and user-triggered member activation remain in place.

### Verification and measurements

See [all test attempts](tests.jsonl), including initial failures and their successful reruns. Final checks: 178 backend tests, 83 frontend tests, 60 MySQL integration tests, both production builds, and canonical/draft/link/whitespace audit passed. Focused cases cover stale approval, scope isolation, untracked/quoted/binary/deleted files, bounded Git invocation counts, strict HTTP routes, overlapping refreshes and independent activation validation.

The personal workspace's old empty Changes chain took 4.85–4.91 seconds and 616 Git processes. Five requests to the new endpoint took 111–136 ms, 14 Git processes each, with a 650-byte response. Development-server samples under concurrent test load took 182–326 ms. The browser showed the complete empty Changes panel in 282 ms; screenshot: `.run/simple-changes-browser.png`. These are measurements of this idle workspace, not a latency guarantee for arbitrarily large changes or queued workspace operations. Combined Git output is bounded at 128 MiB; individual patches retain their 256 KiB display cap.

The idle development backend was restarted to load the change. An initial detached launch ended with its tool process and caused a browser 502; a persistent backend session restored both direct and proxied API access, after which browser verification passed. No personal workspace files, approvals or active member configurations were changed. Existing unrelated untracked files were preserved.
