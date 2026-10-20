# Agent-managed Git and explicit commit approval

Status: proposed
Task start commit: 6aa818217dafb15732d03f82893f0a5895e66588
Review boundaries: [Harness](drafts/workspace-agent/harness/design.md), [Bash](drafts/workspace-agent/harness/tools/bash/design.md), [Group chat approval](drafts/frontend/group-chat/design.md).

## Design outcomes

- planned: remove scoped Git history/index/ref/checkpoint management; agent uses ordinary project Git.
- planned: check explicit commits against their actual candidate changes; implementation-only runs, protected/implementation mixed refuses, design/member-only asks user.
- planned: compact approval input above composer, with Accept, Deny, Send feedback and Review; review details/diffs open in the right panel.
- delivered: persist the agreed conceptual design as explicitly proposed task drafts. Canonical docs/runtime remain unchanged until implementation.

## Decisions and open questions

Detection covers explicit git commit requests only; indirect scripts/programs are outside this prototype check. Dirty files outside the commit candidate do not affect classification. Design and member files can share an approval-required commit. Feedback skips execution and returns the user's message to the agent. Approval applies only to exact reviewed contents. Commit and idle atomic member activation remain separate.

No mandatory .rsi/harness directory remains in the target. Context/member files retain their locations, Git history lives in project .git, shell caches remain outside workspace. Existing materialized markers must be replaced without resurrecting intentionally deleted member files. Do not delete existing metadata in this discussion task.

Follow-up before implementation: unrecognized paths; cross-category renames; supported explicit syntax/options and repository layouts; approval waiting/timeout/cancellation/restart and multiple-client resolution; API/storage schema; accepted-design/member committed-source projections and legacy migration. These are open details, not reasons to add scope histories again.

## Checkpoints and remaining work

Design-only checkpoint. Code, live deployment and personal workspace files are unchanged. Read-only source inspection confirmed .rsi/harness/repository.git, staging/workspace/<part>/<key> and materialized/<member>/<path-hash>. Temporary index files also live there; refs encode scopes, accepted designs and per-run checkpoints. Execution homes/caches use backend-session temporary directories outside .rsi.

Implementation must reconcile harness/tools, workspace/bootstrap, context-base/design-parts, team/lead/member configuration, group publication, conversation lifecycle, agent-runtime and parent frontend/Changes contracts together. Keep durable SQL context versions and member/chat working histories; those are not the removed Git checkpoint mechanism. Promote only implemented behavior with tests later. Current canonical documents intentionally still describe the existing implementation. See [design checks](tests.jsonl).
