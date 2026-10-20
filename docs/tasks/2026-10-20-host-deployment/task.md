# Separate host deployment and development

Status: complete
Task start commit: 0895122c35fbd2ab3946c18ccc6d446347904900
Review boundaries: [Deployment](drafts/host-deployment/design.md), [Development](drafts/local-dev/design.md), [Shared database](drafts/shared-database/design.md)

## Design outcomes
- delivered: deploy committed source under /tmp, run built frontend/backend on host independently of development.
- delivered: existing rsi_agent settings/key are preserved for the running deployment; development uses the new empty rsi_agent_dev database.
- delivered: shared MySQL lifecycle is independent; app stop does not stop MySQL.

## Decisions and open questions
Defaults: development 3000/5273, deployment 3001/5274, all loopback. Deployment durable settings/logs/selection under ~/.local/state/rsi-agent (or XDG_STATE_HOME); replaceable source releases under /tmp/rsi-agent-deploy. Preserve current ignored backend/.env in durable deployment state before creating the development config/key. Existing workspace registrations/files retain their paths; database separation does not duplicate project files. Deploy takes an explicit local Git commit/ref and excludes uncommitted edits. No open behavioral decision.

## Checkpoints and remaining work
Checkpoint 1 implements and promotes all six lifecycle documents, executable wrappers, common settings/ownership helpers, committed-release management, shared database provisioning and built frontend static/stream proxy. Five isolated lifecycle/HTTP tests pass, including real fixture Git exports/npm builds, recovery, source deletion, port/PID isolation, concurrent commands, binary upload and SSE cancellation. Both application builds and document/syntax checks pass. The first test run exposed Node parseEnv key ordering in the lossless serialization check; comparison now checks field values independent of ordering. Live read-only baseline records one workspace, four members, two connections and two readable encrypted credentials.

Checkpoint 2: code commit cb4a0ded73f49dae3f883375ada38551bec4d6e9 was exported under /private/tmp/rsi-agent-deploy, independently installed with npm ci, built and launched on host backend 3001/frontend 5274. Legacy managed development processes were stopped; original settings/key were preserved at /Users/ahua/.local/state/rsi-agent/deploy/backend.env before backend/.env changed to development. MySQL remained the same backend-mysql-1 service/volume. Development was provisioned and launched on 3000/5273.

Live checks compared before/after counts (1 workspace, 4 members, 22 private messages, 2 shared messages, 23 context versions), exact provider-connection and encryption-key fingerprints, and successfully decrypted both saved credentials without displaying them or making provider requests. Development has zero workspaces/members/messages/shared messages/provider connections and a distinct key. Its rsi_dev account was refused a read of deployment workspaces. Repeated starts kept existing processes. Stopping development left deployed built HTML/JS, API and live SSE available on shared MySQL; development was started again and all data checks passed. Both environments remain running. No user workspace files were copied, moved or reset.

Verification: five isolated lifecycle/static/proxy tests, syntax/document audits, both application builds, independent real release install/build, repeated starts, database privilege/data checks and cross-environment stop/SSE checks passed. The existing frontend chunk-size warning remains. Canonical documents and final drafts agree. No work remains; no push/merge requested. Unrelated .claude/ and .DS_Store files are preserved.
