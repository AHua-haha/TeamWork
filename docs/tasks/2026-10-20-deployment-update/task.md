# Deployment version update command

Status: complete
Task start commit: 9eb16dd71365f615275dfb8430b4bddd9fe22e41
Review boundaries: [Host deployment](drafts/host-deployment/design.md)

## Design outcomes
- delivered: update [git-ref] upgrades the selected deployment; default is the project checkout's committed HEAD.

## Decisions and open questions
Update requires an existing deployment, uses local committed source, does not fetch/pull or switch branches, preserves settings/data and uses the same build/readiness/recovery flow as deploy. The same selected commit reuses start/readiness (rebuild only if temporary files are missing). No open question.

## Checkpoints and remaining work
Added update dispatch using the shared deploy/start flows and promoted the completed canonical design and implementation. Six lifecycle/proxy tests pass, including default HEAD updates, explicit refs, same-version reuse, uncommitted-source exclusion, configuration preservation and invalid-ref refusal. Syntax, document parity/links and whitespace checks pass; see [test evidence](tests.jsonl). Unrelated .claude/ and .DS_Store files are preserved. Live deployment was not updated. No remaining work.
