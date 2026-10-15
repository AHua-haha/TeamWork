# Workspace models and read-only member inspection

Status: complete
Task start commit: 79bb89fd6346cf32e457f7ea22cad5d85dcf01bf
Review boundaries: [Workspace](drafts/workspace-agent/workspace/design.md), [Team](drafts/workspace-agent/team/design.md), [Frontend](drafts/frontend/design.md)

## Design outcomes
- [delivered] Workspace model choices and a default initialize leads/new members; agent submissions select workspace models.
- [delivered] Consolidated read-only member inspection includes accepted config/prompts and assembled project/command harness information; remove member write and duplicate config-read HTTP endpoints.
- [delivered] Frontend workspace creation/adoption and workspace model settings, with read-only member inspection. Existing file review APIs remain unchanged.

## Decisions and open questions
Workspace model choices identify provider connection and model, plus optional per-model run parameters. The frontend manages workspace choices/default, while agents manage members through validated file submission. Changing the default does not replace existing assigned models. Saving a first model initializes a legacy unconfigured lead. Existing members retain a removed model selection; a newly selected model must be in workspace choices. Existing workspace models initialize from members' stored selections once; empty legacy workspaces can be repaired through workspace settings. No new file review or history UI/API.

## Checkpoints and remaining work
Delivered backend first, then frontend in one coherent candidate. Canonical [workspace](../../systems/workspace-agent/workspace/design.md), [team](../../systems/workspace-agent/team/design.md), [lead](../../systems/workspace-agent/team/lead/design.md), [database](../../systems/database/design.md), and [frontend](../../systems/frontend/design.md) documents now describe the implementation. No unresolved contract decisions. Preserve unrelated .claude/.

Verification: 85 backend unit/HTTP tests, 39 disposable MySQL integration tests, 48 frontend tests, both production builds, and documentation parity/link/whitespace checks. See [test evidence](tests.jsonl); failed setup/test runs remain recorded alongside passing reruns. The early member-config failure was a test default-reference shape error; the first browser state access and reload assertion failures were test-harness errors fixed before the complete passing flow.

Browser check: start the frontend preview on 127.0.0.1:4274, open a fresh Playwright CLI session named workspace-models, run [browser-setup.js](browser-setup.js) then [browser-check.js](browser-check.js) via run-code --filename. This uses deterministic intercepted backend responses, tests real rendered desktop/mobile create/adopt, accepted-source inspection, no member writes, settings/default/options, conflict draft preservation and explicit reload, and captures screenshots under output/playwright/. Backend HTTP/SQL tests independently cover real persistence and validation. The mocked SSE body closes after sync, so the existing reconnect notice is expected; the injected 409 conflict is the sole expected browser resource error. No paid provider calls were made. Existing file review APIs and behavior are unchanged.

Review through **Show design, team and files → Team → Workspace models** or **Inspect harness**. Restart the backend to load the new routes/table/startup initialization; rebuild/reload frontend as usual. No push or merge is part of this task.
