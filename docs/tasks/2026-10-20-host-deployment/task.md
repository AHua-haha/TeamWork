# Separate host deployment and development

Status: active
Task start commit: 0895122c35fbd2ab3946c18ccc6d446347904900
Review boundaries: [Deployment](drafts/host-deployment/design.md), [Development](drafts/local-dev/design.md), [Shared database](drafts/shared-database/design.md)

## Design outcomes
- delivered: deploy committed source under /tmp, run built frontend/backend on host independently of development.
- delivered: initialization preserves existing rsi_agent settings/key and provisions independent rsi_agent_dev configuration; live cutover remains below.
- delivered: shared MySQL lifecycle is independent; app stop does not stop MySQL.

## Decisions and open questions
Defaults: development 3000/5273, deployment 3001/5274, all loopback. Deployment durable settings/logs/selection under ~/.local/state/rsi-agent (or XDG_STATE_HOME); replaceable source releases under /tmp/rsi-agent-deploy. Preserve current ignored backend/.env in durable deployment state before creating the development config/key. Existing workspace registrations/files retain their paths; database separation does not duplicate project files. Deploy takes an explicit local Git commit/ref and excludes uncommitted edits. No open behavioral decision.

## Checkpoints and remaining work
Checkpoint 1 implements and promotes all six lifecycle documents, executable wrappers, common settings/ownership helpers, committed-release management, shared database provisioning and built frontend static/stream proxy. Five isolated lifecycle/HTTP tests pass, including real fixture Git exports/npm builds, recovery, source deletion, port/PID isolation, concurrent commands, binary upload and SSE cancellation. Both application builds and document/syntax checks pass. The first test run exposed Node parseEnv key ordering in the lossless serialization check; comparison now checks field values independent of ordering. Live read-only baseline records one workspace, four members, two connections and two readable encrypted credentials.

Remaining: execute the actual environment transition against the preserved shared service, verify deployed data/key continuity and empty development data, prove stopping development leaves deployment live, then record completion. No workspace files or existing database records have been changed so far. Preserve unrelated .claude/ and .DS_Store files.
