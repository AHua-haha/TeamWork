# Compact search results and expanded chat duplication

Status: complete
Task start commit: 1a9f94cf09d5da78a75f732e15c282ba0e5613c8
Review boundaries: [web search](drafts/web-tools/design.md), [group publication](drafts/workspace-agent/team/group-chat/design.md), and [working-history projection](drafts/frontend/group-chat/design.md).

## Design outcomes
- [delivered] Use provider snippets only, capped at 300 Unicode characters per result snippet including the truncation marker; preserve title, URL and metadata.
- [delivered] Fix scoped-package identifiers being parsed as group mentions. Verify that expanded Work retains real refused attempts and excludes only the accepted final source, without frontend text deduplication.

## Decisions and open questions
- Do not fall back to verbose provider summaries; long snippet shortening is explicit in metadata.
- Keep group history and private history separate. Identify duplicates from persisted record identities/roles rather than matching prose.

## Checkpoints and remaining work
- Delivered snippet-only output, 300-Unicode-character snippet cap, source/global truncation metadata, and package-token routing fix. No fallback to verbose summaries.
- Full candidate verification passed: 137 backend tests, 48 disposable MySQL integration tests, 64 frontend tests, backend typecheck and backend/frontend production builds. Regression tests were first run against the old implementation and failed for both reported causes; every run is recorded in tests.jsonl.
- A compiled live DeepSeek search on the reported query returned eight results in 5757 UTF-8 bytes, with maximum snippet length 300 characters. The pasted earlier result was about 33 KB; provider results may vary between requests.
- Replayed the actual affected persisted run through frontend runActivity: accepted final source is excluded from Work, two real unpublished candidates and two refusal-feedback messages remain. No frontend rendering change or prose deduplication was necessary. Synthetic regression covers this partition.
- Restarted the idle local backend, verified the 300-character usage rule through inspection and confirmed accepted historical timeline text/references are unchanged. New searches use compact output; stored earlier tool results and genuine retry history remain intact.
- Eight canonical documents match completed drafts and local links resolve. Credentials remain excluded from candidate files. Delivered in one feature-branch commit after the task start. No merge/push requested; no remaining agreed work.

## Diagnosis

Read-only inspection of the affected stored run found distinct assistant records at private positions 14, 16 and 20. Positions 14 and 16 were unpublished reports followed by publication-feedback at 15 and 17: `No active member named "joplin"`. The report contained the npm identifier `@joplin/lib`; the mention parser incorrectly extracted joplin. Position 20 alone is the accepted final reference. Reports are near-identical, not duplicate delivery of one record. The frontend already excludes position 20 from Work and shows the two real refused candidates. Existing historical retries remain inspectable; correct package-token parsing prevents this failure on new publications.

The affected live trace stays in ignored .run storage; regression fixtures use synthetic text. No private user report is added to tests or documentation.
