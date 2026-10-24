# Agent-owned context compaction

## Status

Complete in the accompanying Task-ID commit. User authorized persisting the settled design and implementing it.

## Provenance, boundaries and safeguards

- Task ID: 2026-10-24-agent-compaction.
- Starting commit: 6ac436641a966c6e9013c09fee7556b4133442fc.
- Branch: codex/lead-harness.
- Review boundaries: Agent compaction mechanism and triggers, Team durable hosting, Harness prompt, Runtime/Operations configuration.
- Preserve unrelated .gitignore housekeeping. Do not operate on live databases, registered workspaces, deployments, providers/credentials or the private rsi.config.json. Use disposable resources and deterministic providers for verification.

## Agreed behavior

- A private compaction prompt marks the cut boundary. Old context stays visible during preparation; all new assistant/tool messages after that prompt form the retained private continuation, not only a summary.
- Rebuild model context as original Team-owned group context followed by retained preparation messages. Agent chooses the covered shared range from its own incorporation state using the reference. Team does not summarize group messages or select its range.
- The prompt instructs the agent to end with Next steps when work remains, including objective, next concrete action and blockers/pending decisions. Do not invent work when complete.
- One threshold, contextCompactionThresholdTokens, uses Pi's public estimateContextTokens utility and token units. Check before each ordinary model call and after ordinary work finishes. In-run compaction resumes the same loop; finishing compaction saves state and remains idle. No new activation, run or mention is created.
- Invalidate usage measured before context replacement; estimate rebuilt content until new usage is available.

## Implementation decisions

- Release-owned instruction file in Harness; Agent receives the prompt/config by public execution inputs. Default operator testing threshold: 64,000 tokens, configurable separately in each dev/deployment section using the same field. The field is optional for existing files; launcher/backend defaults match. Low-level Agent callers opt in by providing compaction settings.
- Reuse one model/tool turn engine for ordinary work and preparation. Private preparation bypasses group final-response routing and threshold recursion, and uses the same tools/permissions. Bound preparation by the existing 64-call budget independently of ordinary calls.
- Durable preparation lifecycle is a context_compactions journal plus immutable messages tagged context-compaction under the existing owning run. These are not additional run rows. Candidate context replaces the old context only when preparation naturally completes and SQL acknowledges an atomic cutover.
- On failure/cancellation, keep the old prefix and append recorded preparation/explicit failure information rather than losing tool-effect knowledge. A running trigger failure ends the ordinary run explicitly; finishing failure does not change its completed response/status. Never start preparation on an already-aborted signal; stop/shutdown abort preparation. Recovery retains old context plus recorded interrupted preparation without replay.
- Retain the group prefix already incorporated at the checkpoint; later shared messages remain buffered. Finishing synchronization can append arrivals after preparation. One preparation attempt per checkpoint, with no recursive retrigger if unchanged group context alone exceeds the threshold.
- Compaction preparation does not masquerade as streaming ordinary response output. Completed preparation records are private stable history; final references and public response working ranges remain pinned. No frontend layout change is introduced.

## Plan and evidence

Draft contracts and implementation plans are under drafts/. Every verification command, including failed/blocked runs, is appended to tests.jsonl. Promote delivered behavior to canonical context with source/tests before commit. No push/merge/deployment is requested.

## Delivered result

- Canonical Core/Agent/Team/Harness/Runtime/Operations contracts and implementation contexts now match the delivered behavior; subordinate references and entry guides were reconciled.
- Agent has one shared ordinary/preparation turn engine, Pi public normalized-context estimation, identical before-call/after-run threshold checks, private trace preservation and acknowledged cutover. The maintained instruction requests Next steps for remaining work.
- Team owns SQL preparation journal/history/cutover/recovery. Public final references remain pinned; stop covers private finishing jobs; uncertain persistence acknowledgement cannot be hidden by an already completed publication.
- Operations accepts optional per-environment contextCompactionThresholdTokens, defaults to 64000, validates positive safe integers and supplies only isolated child-process settings. Existing real configuration was not modified.
- Original group history is preserved, not summarized. No new frontend control, HTTP endpoint, context tool, ordinary run or mention is introduced. No live data reset, provider call, deployment, merge or push was performed.

## Verification and resolved failures

Final checks pass: 209 backend unit/HTTP tests, 74 disposable MySQL integration tests, 15 isolated host-script tests, backend type check/build, 12-node RSI mapping/document/link validation, packaged compaction prompt/compiled startup and Git whitespace check. Each execution is retained in tests.jsonl with the full starting SHA.

Earlier failures remain recorded. Extraction initially added a redundant shared read with compaction disabled; restored the existing boundary behavior. A new test needed one local value for TypeScript union narrowing. A large-shared-history test initially supplied an unrealistically low faux provider usage report; corrected the fixture to exercise both threshold checkpoints. SQL lifecycle assertions initially treated the driver-returned versioned JSON envelope as raw text/direct state; corrected them to use the existing durable decoder. No production contract was weakened to pass these checks.

Checks cover all retained preparation messages/tool results, same-run continuation, finishing without extra work, independent checkpoints/non-recursion, preparation failure, stop, acknowledged atomic cutover rollback, restart including already completed publications, immutable stable usage/history, invalidated context usage, original sender/group coverage, reset and configuration isolation. The acknowledged persistence-failure path leaves preparation recoverable rather than applying a competing replacement.

## Limits and handoff

The default threshold is a prototype operator setting, independent of per-model contextBudget. Pi estimation remains approximate when provider usage is unavailable. Original shared history is not reduced and can still exceed a model window or threshold; preparation has no recursive retry at one checkpoint. Preparation may use ordinary tools under the existing Harness rules; external effects are not transactional and never automatically replayed. An uncertain persistence acknowledgement is reported explicitly and requires runtime recovery. Restart the affected backend to load this release and configuration; schema initialization creates the journal normally. Unrelated .gitignore changes remain outside the commit.
