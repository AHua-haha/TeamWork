# Host deployment lifecycle

## Purpose and boundary

Manage a host-run deployed application independently of the development checkout/processes. Deployment uses the existing application data and credentials. The database server is shared infrastructure; workspace/project files are not copied or relocated by deploying application source.

## Inputs and preconditions

scripts/deploy.sh supports init, deploy <git-ref>, update [git-ref], start, stop, restart, status and logs [backend|frontend]. Node.js 22.19+, npm, Git, tar, curl/ps and the shared MySQL service are available. A deploy ref must resolve to a local commit containing the application and host frontend entry point. The default backend/frontend bind to loopback 3001/5274. Development remains on 3000/5273. Project-root rsi.config.json is the single authority for both environments, shared MySQL address/credentials, ports, backend credentials and state/source paths. It is private (0600), excluded from Git and deployment archives; rsi.config.example.json documents the format without real secrets. State defaults to ~/.local/state/rsi-agent and deployment source to /tmp/rsi-agent-deploy. Environment variables, including RSI_*, DATABASE_URL, PORT, NODE_OPTIONS and COMPOSE_*, cannot override managed service settings. The deployment source path must be within temporary storage and all service ports must be distinct.

## Outputs and observable effects

init creates rsi.config.json once, importing existing backend/.env and saved deployment/backend.env without changing those files. Existing database identities, passwords, encryption keys and explicit backend credentials are preserved; a new development key/database is generated only for an initial unsplit setup. One shared MySQL host/port is stored, with separate rsi_agent and rsi_agent_dev accounts/keys. Conflicting legacy server addresses refuse import. Once the project config exists, old env files are never read again. Repeated initialization leaves the config unchanged.

deploy exports the specified committed source into a separate temporary release, installs locked dependencies and builds both packages before stopping the previous deployment. Uncommitted development edits and environment files are excluded. It starts the compiled backend and a host static frontend server forwarding API/upload/SSE traffic to that backend. Readiness precedes publishing the active release selection. Build failure leaves the current deployment running. Launch failure stops the new processes and attempts to restart the previous running release, reporting recovery failure explicitly. This is code recovery, not database migration rollback.

update [git-ref] updates an existing selected deployment, defaulting to the project checkout's committed HEAD. It resolves local committed source without fetching/pulling, switching branches or including uncommitted edits. A missing initial deployment fails with deploy guidance. A different commit uses the same build-before-stop, readiness, state preservation and recovery guarantees as deploy. Updating to the already selected commit reuses start/readiness and keeps healthy process IDs unchanged; missing temporary source is rebuilt as in start. Invalid refs leave the current deployment untouched.

start uses the selected release; when temporary files have been removed, it rebuilds that exact saved commit before starting. start with no selected release fails with deploy guidance. start is idempotent when both managed services are healthy. stop stops only identified deployment processes and preserves database, configuration and source selection. restart stops/starts the selected release. status and logs do not require source files or a running database. Settings, logs and process ownership live outside /tmp. The frontend serves built assets and images/API bodies without whole-response buffering; SSE stays live, and disconnects close proxy requests.

## Failure behavior

Invalid refs, missing tools/dependencies, incompatible database identity, occupied ports, corrupted/missing keys or readiness failures produce nonzero results without printing secrets. An unrelated process is never killed based on its port or a reused PID. Concurrent lifecycle mutations are refused. Source deletion is never treated as permission to kill an unrelated process. An existing database runtime owner must stop before another backend can acquire it. Database data are never dropped/truncated or copied during deployment or initialization.

## Guarantees and limits

Only backend/frontend run directly on the host; the existing MySQL container/volume may remain. Service ports are loopback by default; no TLS/public exposure, boot-time supervisor or automatic updates are introduced. Database schema migration follows the backend's existing startup behavior. Historical source must remain available in local Git to rebuild it. Source/build files are replaceable; never put deployment keys or user workspaces in the temporary release. Database separation does not isolate manually shared project directories.

## Acceptance examples

Existing data/credentials appear on the deployed UI while the new development UI has no workspaces/connections. Both run simultaneously. Stop development: deployment and MySQL remain available. A bad build or unrelated occupied deployment port does not damage the current release/data. Restart after deleting stopped temporary source rebuilds the saved commit and preserves data. Long-lived group SSE and picture uploads work through the deployed frontend.

Update acceptance: deploy version A, commit B in the project checkout and run update without arguments: B is served and selected, while settings/database remain the same. Repeat update: the same processes remain. update <tag-or-commit> selects that exact version without changing the development checkout. A bad ref leaves the selected release running.

## Configuration isolation

Launchers pass a clean child-process environment containing explicitly configured application values plus necessary host/toolchain variables. They never edit shell profiles, export variables into the caller, rewrite env files or change Docker global settings. Unrelated processes/ports are never taken over; shared MySQL is managed by its explicit project identity. Editing application configuration requires restarting the affected service. Starting an application never recreates an existing shared MySQL container to apply changed bindings. Protection covers accidental inherited settings and file permissions; another process running as the same OS user can still deliberately edit accessible files or occupy ports.

The environment's optional harnessPermissionsEnabled Boolean defaults to true. false disables runtime harness tool/path/sandbox/commit enforcement; true restores existing rules. Restart the backend after changes; no runtime toggle or member-file permission grant is provided. Launchers pass the value only to their own backend child.
