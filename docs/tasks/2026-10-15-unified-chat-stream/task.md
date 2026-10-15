# Unified group-chat streaming presentation

Status: complete
Task start commit: 0325858bbdf2c2491d1fb9f38f2ec79d1f22e21e
Review boundaries: [Frontend group chat](drafts/frontend/group-chat/design.md)

## Design outcomes

- [delivered] Present each active member run as one ordered stream of visible text and tools; hide thinking blocks.
- [delivered] Fold preceding work once when the backend confirms the accepted final answer, keeping that answer fully visible in the reserved member section.
- [delivered] Combine consecutive tools into collapsible sets across assistant messages that contain no visible text; preserve independent disclosures during updates.
- [delivered] Replace the completion tool and stream annotations with ordinary completed model output, exact final text-block references and atomic group acceptance.

The accepted [draft design](drafts/frontend/group-chat/design.md) and [canonical design](../../systems/frontend/group-chat/design.md) describe the same delivered behavior. Runtime, storage, team, lead, harness and parent frontend documents are reconciled with it.

## Decisions and open questions

The user's two screenshots from 2026-10-15 20:12 show the intended effect: visible commentary, compact tool-set summaries, expandable tool rows, and subsequent visible commentary in one ordered flow. Thinking blocks remain absent even when working history is expanded. Keep the previously accepted reading width, avatar gutters, user-message layout and compact run controls.

The UI does not need to know whether ordinary text is working or final before displaying its first token. It streams both through the same presentation while the run is active. Backend-confirmed final identity and successful group publication establish the final layout: earlier work folds, the accepted final remains outside, and expanding Work restores the earlier visible text and tool sets without duplicating the final. This confirmation can arrive after text generation finishes. Native provider phase may inform backend classification; absent phase is not evidence that text is final. Failed, interrupted, truncated or refused output is not promoted solely because streaming stopped.

This implementation supersedes the separate active working/final stream requirement and completion tool from task 2026-10-15-explicit-response-streams. Ordinary model output and backend completion/publication decisions establish final acceptance. Tools continue execution; native commentary continues privately; natural completion selects final text blocks; truncation fails without publication. No prose heuristic or custom completion tool is required. Providers without phase metadata cannot distinguish commentary from final text before natural completion, so the active UI streams both through the same flow.

Defaults: active work is visible; tool sets start collapsed; final acceptance automatically folds prior work once; the user can then expand or collapse it. Tool-set disclosures remain independent of the whole Work disclosure. A nonempty displayed text block separates tool sets; hidden thinking and paired tool results do not. Grouping never crosses an activation or author boundary.

## Checkpoints and remaining work

Implementation increment starts at d56704dea4ac72659e20731e9da5a94eeece42ac. Keep the original task starting commit for the proposal history. Backend selection uses completed model output: tools continue, native commentary continues, natural completion selects final text blocks, and truncation fails without publication. New final references pin exact text block indices. Retain read-only decoding for already accepted historical references; no old completion tool or stream annotation remains available to new runs.


The proposal was saved in d56704dea4ac72659e20731e9da5a94eeece42ac. The implementation checkpoint promotes all 16 affected design/implementation drafts with code and tests. New final references pin contentIndices; read-only historical decoding preserves already accepted plain-message and retired-tool records. No database migration or history rewrite is needed. The unrelated untracked .claude/ directory is excluded.

Verification: 89 backend tests, 56 frontend tests, 42 disposable MySQL integration tests, both builds, frontend type check and documentation parity/link audit passed. The controlled SSE browser pass covers live text/tools, hidden thinking, grouping/state retention, collapse/reconnect, accepted-final partition, empty work, failure, reverse completion, reload, desktop/mobile overflow and scroll. Screenshots were visually inspected. It makes no paid provider calls and does not use the user's database or running app.

Two browser-check failures are retained in [tests.jsonl](tests.jsonl): the initial check incorrectly required collapsed replayed history to be unmounted rather than hidden; the second needed viewport resizing and native scroll events to settle before testing bottom-follow behavior. The corrected check passes; neither required an application-code change. Test commands and increment starting commits are recorded in that file. Restart the backend and reload the frontend together for review. No remaining design decision is open.
