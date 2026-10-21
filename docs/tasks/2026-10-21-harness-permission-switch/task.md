# Harness permission switch

Status: complete
Task start commit: 1d84012da67a98873334ae479ec10a40f004ceb5
Review boundaries: [Harness](drafts/workspace-agent/harness/design.md), [Bash](drafts/workspace-agent/harness/tools/bash/design.md), [Development](drafts/local-dev/design.md), [Deployment](drafts/host-deployment/design.md).

## Design outcomes

- delivered: one backend startup permission switch per project environment; omitted means enabled. Set both current local sections to disabled.
- delivered: disabled bypasses tool selection/role gates, file workspace/scope/symlink checks, OS Bash sandbox and explicit Git commit approvals; agents have the backend OS account's ordinary file/command/network authority, without extra OS privilege.
- delivered: preserve native tool behavior, persistent shell lifecycle/timeouts, backend secret isolation, design context/maintenance guidance and member configuration validation/atomic user activation. Restoring true restores existing permission enforcement after backend restart.

## Decisions and open questions

Use development.harnessPermissionsEnabled and deployment.harnessPermissionsEnabled in project-root rsi.config.json. Launchers derive a private child setting; do not edit global environment or shell profiles. A backend restart is required; this task changes current private config without restarting/deploying live services or interrupting runs. Native shell uses host HOME and toolchain PATH when enforcement is disabled, but does not inherit backend credentials. No live model requests.

## Checkpoints and remaining work

Implemented the operator startup switch through host configuration, strict backend parsing, purpose/tool assembly, role-sensitive management tools, native file invocation and persistent Bash. Disabled shells do not initialize the sandbox or approval broker and use clean host tooling/HOME. Enabled behavior remains in place. Runtime maintenance instructions identify the selected mode without false permission/approval claims.

Set both current private config sections to false, verified mode 0600 and exact preservation of all other values. No live service restart, deployment update, model request, database change or member activation was performed. The currently selected deployed release predates this feature; it must be updated to this task's commit before the setting can affect that service. Development uses this checkout after restart.

Verification: all 188 backend tests, all 13 host config/lifecycle/proxy tests, the 20-test focused harness/shell/approval run and backend build passed. Failures retained in tests.jsonl: an invalid-config fixture initially wrote an ignored file instead of corrupting an actual member manifest; host lifecycle expected response objects initially omitted the newly exposed fixture flag. Both tests were corrected and rerun. Native file/link/outside edits, worker management availability, unchanged semantic validation, unrestricted mixed/protected/background commits, secret isolation, timeout, and restoring sandbox boundaries are covered. Canonical documents match the completed drafts. No remaining implementation work.
