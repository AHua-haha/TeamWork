# Project and command harnesses

Status: complete
Task start commit: 2bed356979b92b21851a15855a4799e00cb95ea2
Review boundaries: [Harness](drafts/workspace-agent/harness/design.md), [Team](drafts/workspace-agent/team/design.md)

## Design outcomes
- [delivered] One fixed project harness owns design management and implementation together; independent design/implementation parts retain their permissions and histories.
- [delivered] A separate command harness owns the existing allowed-command capability. Rich command-boundary rules and its agent configuration remain deferred.
- [delivered] Version 2 member manifests group designScope and implementationScope under harnesses.project. Existing active-member accepted bundles migrate once while pending drafts and retired records are preserved.

## Decisions and open questions
Project is the combined harness name. Design commits still require user acceptance; implementation commits permit agents. Harness identity and independent Git part identity are separate concepts. Existing user API assignment fields and command matching behavior remain unchanged. Agent file submissions only configure the project harness; current command allowances still inherit on creation and persist on update. No additional command policy or configuration choices are introduced.

## Checkpoints and remaining work
Delivered: fixed project/command definitions, command-owned tool selection and rule prompt, version 2 project-grouped manifests and a startup-only accepted-source conversion. Design/implementation/member-config parts keep the same Git identities and commit permissions. The source upgrade preserves Markdown bytes, active settings and allowances; it leaves pending drafts and retired historical records alone. Existing user HTTP assignment fields remain unchanged.

Final candidate passed 79 backend unit/HTTP tests, 38 disposable MySQL/runtime integration tests, the backend build and 8-file documentation parity/link/whitespace audit. Checks were rerun after adding the retired-source initialization guard. Command tool revocation and independent per-part state are covered. See [test evidence](tests.jsonl).

Richer command boundary rules and agent-facing command configuration remain deferred. Existing version 1 pending drafts require explicit regrouping and revision reconciliation; the lead receives the new schema and instructions. Unrelated .claude/ is preserved. No push/merge.
