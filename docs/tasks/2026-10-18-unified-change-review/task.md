# Unified design and member change review

Status: complete
Task start commit: 798082e1286af58bf4d9fd8947508e05e449a5b7
Review boundaries: frontend Changes tab and scoped user approval.

## Design outcomes
- [delivered] Remove Team's Configuration changes subpage; add a permanent Changes tab beside Design, Team and Files.
- [delivered] One simple flat list and unified text diff for pending design/member files, with separate Approve design and Approve members actions.
- [delivered] Keep member activation separate, display blocking validation issues, and refresh readiness after design approval.

## Decisions and open questions
- The diff reviews exactly committed-to-current pending content for each scope. Approved files leave this list; approved but inactive members have a separate activation action/status. Old active-to-current inspection APIs remain available to other callers.
- Approvals use exact reviewed revision/base tokens through existing user commit APIs. They never activate members or accept another scope. Scope errors and stale edits preserve data and refresh the review.
- Use a generic read-only scope review endpoint for file patches; no frontend parsing of combined Git patches or new structured member editor.
- This task adds controls only. Do not approve or activate the personal todo workspace's pending design/member changes automatically.

## Checkpoints and remaining work
- Delivered the permanent Changes tab, shared flat file review, independent scoped approvals and separate activation. Removed the old Team subpage and its components/styles. Canonical frontend/harness documents and team coordination notes now describe the implemented behavior.
- Verified: 149 backend unit/HTTP tests, 55 MySQL integration tests and 74 frontend tests passed; both builds passed. Browser verification against a disposable actual HTTP/harness backend passed independent approvals, stale refusal, design-dependent activation, preserved later pending member edits, active-team display, desktop/narrow layouts and reload.
- Verification found and corrected a Buffer/string assertion, the fixture file's ESM extension, and a container-width layout defect. Later browser attempts failed on a test-only mobile sidebar click and a closed browser session; the final workflow passed after correcting those procedures. Failed runs remain in tests.jsonl.
- Restarted the idle managed backend and verified exact preservation of workspace registrations, agents, active team, group chat/timeline and approval state. Its new review endpoint exposes the real workspace's seven pending design files. No real design/member approval or activation was performed. Disposable browser/backend/frontend processes were closed.
- Documentation parity, canonical local links, obsolete component removal, credential exclusion and whitespace audits passed. No remaining design decisions or implementation work. See [test evidence](tests.jsonl).
