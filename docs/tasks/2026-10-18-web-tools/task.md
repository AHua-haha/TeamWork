# DeepSeek web search and fetch tools

Status: complete
Task start commit: 320f0d7a36ca158dbbf8b208a914d89a505e8baf
Review boundaries: [web tools](drafts/web-tools/design.md) and [harness capability assembly](drafts/workspace-agent/harness/design.md).

## Design outcomes
- [delivered] Add reusable `web_search` and `web_fetch` tools backed by DeepSeek, with backend-only credentials and no member/UI configuration.
- [delivered] Inputs: search query, optional count (default 5, 1–50), optional original_question; fetch URL only. Filters stay in the search query.
- [delivered] Return one readable Markdown text result followed by a `<metadata>` block, not an outer JSON string.

## Decisions and open questions
- First verify the supplied credential and both live API endpoints. Never include the credential in tracked files, test evidence, or tool results.
- Harnesses own capability availability; the tools are reusable across agents and do not depend on the agent's model provider.

## Checkpoints and remaining work
- Both live provider endpoints returned HTTP 200 with the supplied credential; search returned a source and fetch returned Example Domain Markdown. Credential saved in ignored backend/.env with mode 0600.
- Delivered [web tool contract](../../systems/web-tools/design.md), [implementation](../../systems/web-tools/impl.md), and updated [harness contract](../../systems/workspace-agent/harness/design.md) with reusable capability assembly.
- Final candidate passed 134 backend tests, 47 disposable MySQL integration tests, typecheck and build. Earlier targeted checks and all failed checks are retained in tests.jsonl. The final watcher check passed; an earlier run skipped it because file events were unavailable.
- Both compiled tool implementations passed live calls, verifying one Markdown text result with a metadata block. MySQL/frontend follow checks preserve results across model-context compaction and record safe failures.
- Restarted the idle local backend at port 3000; active member inspection exposes both tools and the file-backed execute rules. No live model run or workspace-file mutation was needed.
- Canonical documents match the completed drafts, documentation links resolve, candidate files contain no deployment credential, and the key remains only in ignored backend/.env (0600).
- Complete in one feature-branch commit after the task start, identified by Task-ID below. No push or merge requested. No remaining agreed implementation work.

- Routine implementation defaults: fixed execute base exposes both tools independently of Bash; 30-second deadline, 4 MiB response body and 64 KiB Markdown core limit; visible truncation; no automatic retries. Existing runtime tool-error behavior remains in effect. Metadata uses YAML fields inside the agreed tag block.

## Verification

See [tests.jsonl](tests.jsonl). The initial API probes and compiled live smoke checks used the user-supplied credential without recording it. Implementation tests use fake credentials and mocked responses; MySQL runs use disposable containers. Operational preflight/launcher mistakes were corrected and logged without changing the tool contract.
