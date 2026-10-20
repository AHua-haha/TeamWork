# Host deployment lifecycle

## Purpose and boundary

Manage a host-run deployed application independently of the development checkout/processes. Deployment uses the existing application data and credentials. The database server is shared infrastructure; workspace/project files are not copied or relocated by deploying application source.

## Inputs and preconditions

scripts/deploy.sh supports init, deploy <git-ref>, start, stop, restart, status and logs [backend|frontend]. Node.js 22.19+, npm, Git, tar, curl/ps and the shared MySQL service are available. A deploy ref must resolve to a local commit containing the application and host frontend entry point. The default backend/frontend bind to loopback 3001/5274. Development remains on 3000/5273. Source defaults to /tmp/rsi-agent-deploy, durable environment state to ~/.local/state/rsi-agent (XDG_STATE_HOME respected). RSI_STATE_DIR and RSI_DEPLOY_ROOT can choose independent locations; the latter must be within the system temporary directory. Optional RSI_DEPLOY_BACKEND_PORT/RSI_DEPLOY_FRONTEND_PORT choose deployment ports; they must differ.

## Outputs and observable effects

init preserves existing backend/.env in durable deployment configuration before development switches databases. Deployment retains its existing DATABASE_URL naming rsi_agent and CONFIG_ENCRYPTION_KEY, including saved-provider decryption. Development receives rsi_agent_dev and a separate generated key. Repeated initialization preserves both environments' subsequent edits/data.

deploy exports the specified committed source into a separate temporary release, installs locked dependencies and builds both packages before stopping the previous deployment. Uncommitted development edits and environment files are excluded. It starts the compiled backend and a host static frontend server forwarding API/upload/SSE traffic to that backend. Readiness precedes publishing the active release selection. Build failure leaves the current deployment running. Launch failure stops the new processes and attempts to restart the previous running release, reporting recovery failure explicitly. This is code recovery, not database migration rollback.

start uses the selected release; when temporary files have been removed, it rebuilds that exact saved commit before starting. start with no selected release fails with deploy guidance. start is idempotent when both managed services are healthy. stop stops only identified deployment processes and preserves database, configuration and source selection. restart stops/starts the selected release. status and logs do not require source files or a running database. Settings, logs and process ownership live outside /tmp. The frontend serves built assets and images/API bodies without whole-response buffering; SSE stays live, and disconnects close proxy requests.

## Failure behavior

Invalid refs, missing tools/dependencies, incompatible database identity, occupied ports, corrupted/missing keys or readiness failures produce nonzero results without printing secrets. An unrelated process is never killed based on its port or a reused PID. Concurrent lifecycle mutations are refused. Source deletion is never treated as permission to kill an unrelated process. An existing database runtime owner must stop before another backend can acquire it. Database data are never dropped/truncated or copied during deployment or initialization.

## Guarantees and limits

Only backend/frontend run directly on the host; the existing MySQL container/volume may remain. Service ports are loopback by default; no TLS/public exposure, boot-time supervisor or automatic updates are introduced. Database schema migration follows the backend's existing startup behavior. Historical source must remain available in local Git to rebuild it. Source/build files are replaceable; never put deployment keys or user workspaces in the temporary release. Database separation does not isolate manually shared project directories.

## Acceptance examples

Existing data/credentials appear on the deployed UI while the new development UI has no workspaces/connections. Both run simultaneously. Stop development: deployment and MySQL remain available. A bad build or unrelated occupied deployment port does not damage the current release/data. Restart after deleting stopped temporary source rebuilds the saved commit and preserves data. Long-lived group SSE and picture uploads work through the deployed frontend.
