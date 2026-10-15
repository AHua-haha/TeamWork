# Unified group-chat streaming presentation

Status: proposed
Task start commit: 0325858bbdf2c2491d1fb9f38f2ec79d1f22e21e
Review boundaries: [Frontend group chat](drafts/frontend/group-chat/design.md)

## Design outcomes

- [planned] Present each active member run as one ordered stream of visible text and tools; hide thinking blocks.
- [planned] Fold preceding work when the backend confirms the accepted final answer, keeping that answer fully visible in the reserved member section.
- [planned] Combine consecutive tools into collapsible sets across assistant messages that contain no visible text.
- [delivered] Persist the agreed presentation design and its proposed implementation plan. Runtime implementation is outside this request.

## Decisions and open questions

The user's two screenshots from 2026-10-15 20:12 show the intended effect: visible commentary, compact tool-set summaries, expandable tool rows, and subsequent visible commentary in one ordered flow. Thinking blocks remain absent even when working history is expanded. Keep the previously accepted reading width, avatar gutters, user-message layout and compact run controls.

The UI does not need to know whether ordinary text is working or final before displaying its first token. It streams both through the same presentation while the run is active. Backend-confirmed final identity and successful group publication establish the final layout: earlier work folds, the accepted final remains outside, and expanding Work restores the earlier visible text and tool sets without duplicating the final. This confirmation can arrive after text generation finishes. Native provider phase may inform backend classification; absent phase is not evidence that text is final. Failed, interrupted, truncated or refused output is not promoted solely because streaming stopped.

This proposal supersedes the frontend's separate active working/final stream requirement from task 2026-10-15-explicit-response-streams. Consistent with the preceding discussion, the target should use ordinary model output and backend completion/publication decisions rather than require the agent to invoke final_response. The currently committed implementation still requires that tool. Follow-up implementation must revise the affected team, harness, runtime, storage and parent frontend contracts together; this design-only request does not change those canonical contracts or choose a new endpoint/schema.

Defaults: active work is visible; tool sets start collapsed; final acceptance automatically folds prior work once; the user can then expand or collapse it. Tool-set disclosures remain independent of the whole Work disclosure. A nonempty displayed text block separates tool sets; hidden thinking and paired tool results do not. Grouping never crosses an activation or author boundary.

## Checkpoints and remaining work

Saved [design](drafts/frontend/group-chat/design.md) and [proposed implementation](drafts/frontend/group-chat/impl.md). Canonical documents continue describing committed behavior. Backend/frontend implementation, runtime tests and browser review remain pending until implementation is requested. Preserve the unrelated untracked .claude/ directory.

Document verification is recorded in [tests.jsonl](tests.jsonl). No application test result is claimed for this proposal.
