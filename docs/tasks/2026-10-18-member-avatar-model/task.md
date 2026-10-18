# Member avatar model settings

Status: complete
Task start commit: bca3fae253f7a5f7525bdfe50e025a95e140a631
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Team](drafts/workspace-agent/team/design.md) and [Frontend](drafts/frontend/design.md).

## Design outcomes
- [delivered] Hover/focus/click an active member avatar in group chat to configure model, reasoning and other model options using the composer picker controls.
- [delivered] User-only, revision-protected member model settings API; saved settings apply to subsequent runs.

## Decisions and open questions
The user authorizes freely configuring these member settings through a backend API. User model preferences are stored on the member database record separately from the agent-managed manifest snapshot. Existing files continue defining prompts, tools and assignments; file activation preserves user model choices. All configured provider models are available to the user, as in the previous composer. Workspace model lists still constrain agent-created member defaults.

## Checkpoints and remaining work
One consistent checkpoint delivers the user-only API, stable per-member preferences, shared picker and avatar panel. Canonical designs/implementations are promoted with the code. Verification: 124 backend tests, 63 frontend tests, 46 real MySQL integration tests, both builds, and browser checks of settings saves, reload, model switching, member isolation, focus and Escape. Final stricter required-field validation also passed the 14 affected team/HTTP tests and backend build. All runs, including initial typecheck failures resolved during development, are in [test evidence](tests.jsonl).

The running local backend was restarted after confirming no workspace member was running; the new endpoint was verified without changing real workspace preferences. Existing unrelated untracked files remain untouched. No remaining design decisions or implementation work.
