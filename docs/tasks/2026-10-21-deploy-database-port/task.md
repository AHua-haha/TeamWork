# Correct deployment database port

Status: complete
Task start commit: b2734b1bb4232889f5d5c2618c2d96c9cc576f08
Review boundary: [Host deployment](../../systems/host-deployment/design.md).

## Design outcomes

- delivered: restore startup under the existing shared-database contract by correcting a local saved deployment setting. No source or canonical contract changes are needed.

## Decisions and open questions

Development uses 127.0.0.1:3306, but deployment was configured for 127.0.0.1:4211. initializeEnvironments correctly refuses different shared-server identities before launching. No listener exists on 4211. Compose exposes 3306; the saved deployment credentials authenticate to the existing rsi_agent database there (2 workspaces, 10 agents). Preserve credentials, encryption keys, database names and development settings. Change only the deployment URL port, then start the already selected release.

## Checkpoints and remaining work

Changed only the saved deployment URL port to 3306, under the lifecycle lock. Verified every other deployment setting and the entire development settings object remained unchanged. The selected existing release b2734b1 started successfully: backend 3001, frontend 5274 and its /agents proxy returned HTTP 200. Database counts remain 2 workspaces and 10 agents. See [verification evidence](tests.jsonl). No provider model calls, database reset, code deployment or checkout changes are requested.
