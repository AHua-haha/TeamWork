# Recoverable tool errors and individual failure color

Status: complete
Task start commit: 29cd7923b4c1291c39e1ddafcead4dc7feb44b78
Review boundaries: [runtime](drafts/agent-runtime/design.md), [group UI](drafts/frontend/group-chat/design.md).

## Design outcomes
- [delivered] Persist tool failures as error results and continue the agent loop so the model can respond to them.
- [delivered] Finish the remaining calls in a response after a failed tool; no automatic retry.
- [delivered] Only failed tool rows are red; aggregate summaries and successful siblings stay neutral.

## Decisions and open questions
- Returned isError results and exceptions from tool lookup, argument validation or execution are recoverable at the tool boundary. Preserve supplied results/details; convert exceptions to readable error results. Cancellation, runtime ownership loss, model/protocol, persistence and request/continuation/finalization hook failures remain terminal.
- Existing web error metadata, including retryable, is unchanged. Recoverable means the model may handle the error; it does not promise a retry will succeed or automatically repeat external effects.
- Historical failed runs remain historical records; this changes future execution.

## Checkpoints and remaining work
- Delivered one result/continuation path for successful and failed tools, preserving native content/details and call order; removed the old fail-run branch. Updated file-backed execute guidance. Canonical contracts match completed drafts.
- Removed aggregate failure-color inheritance and limited red to the failed call summary, including hover. Successful sibling rows, aggregate summary and expanded result bodies remain neutral.
- Verified 148 backend tests, 55 disposable MySQL integration tests, 71 frontend tests and both builds. Integration covers returned/thrown errors, unknown tools, argument validation, later calls in the same batch, preserved error details, no implicit retry, error-result persistence failure, cancellation/finalization boundaries and successful group publication after private error. See [evidence](tests.jsonl).
- Browser checks cover neutral/red computed colors, hover, disclosures, continued output, successful final, reload and mobile overflow. The first browser run completed desktop checks but its mobile scrim click was intercepted by the sidebar; the final script uses the visible sidebar rail toggle and passes. Reproduction uses [fixture](browser-server.mjs) at 4280, Vite at 5276 with AGENT_BACKEND_ORIGIN=http://127.0.0.1:4280 and [checks](browser-check.js) for ?workspace=tool-review. Screenshots are ignored output/playwright/recoverable-tool-errors-{desktop,mobile}.png.
- Restarted the idle managed local backend and verified existing workspace/member/chat/agent state was unchanged. Historical failed runs were not rewritten, reset or automatically resumed. No paid model/provider calls were made. Disposable browser/fixture processes were closed.
- All agreed work is complete in this feature-branch checkpoint. No push or merge requested.
