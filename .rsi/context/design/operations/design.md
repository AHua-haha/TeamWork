# Operations

## Purpose, responsibilities and boundaries

Run the project on the operator's host in two independent environments that share one local MySQL service: a **development** environment built from this checkout, and a **deployment** environment built from a committed Git revision into temporary storage. This system owns process lifecycle, environment configuration, database provisioning and the small static/streaming frontend host used by deployment.

It does not own application schemas or records (the backend migrates and owns those on startup), the user's provider credentials' meaning (config does), or the user's project directories, which are never copied or moved by deploying.

## Interface contract

**Purpose and supported interactions.** Through shell entry points the operator initializes environments, deploys a committed revision, updates a deployment to another revision, and starts, stops, restarts, inspects status and reads logs for each environment. Through a third entry point the operator starts, stops and inspects the shared MySQL service and provisions the development database.

**Required inputs and returned information.** `deploy <git-ref>`, `update [git-ref]`, `start`, `stop`, `restart`, `status`, `logs [backend|frontend]`, `init`; `dev.sh` offers the same lifecycle without deploy; `database.sh start|stop|status`. Environment variables may override durable state directory, temporary source root and deployment ports. Commands report health, selected revision, process identity, log tails and explicit nonzero failures.

**Observable effects.** Development uses `rsi_agent_dev` with its own encryption key at loopback 3000/5273; deployment uses the existing `rsi_agent` with its existing key at loopback 3001/5274, serving built assets through a host frontend that streams API/upload/SSE traffic to the loopback backend. Initialization preserves the pre-existing deployment database URL and key in durable state before the development configuration is created. Deployment builds locked dependencies in a unique temporary release, starts it, checks readiness and only then switches the active release. Database volumes and data are never dropped, truncated or copied.

**Failure behavior and lifecycle.** Invalid refs, occupied ports, missing tools, corrupted keys or readiness failures produce nonzero results without printing secrets. A build failure leaves the current deployment running; a launch failure stops the new processes and attempts to recover the previous running release (code recovery only, never migration rollback). Stops act only on positively identified processes, never on foreign PIDs or ports. Concurrent lifecycle mutations are refused. Stopping an application never stops the shared MySQL service; only an explicit database stop does, and it preserves the volume.

## Constraints, specifications and requirements

- Requires Node.js 22.19+, npm, Git, tar, curl, ps and Docker Compose for the MySQL service.
- Deployment source root must be inside the system temporary root and is replaceable; durable settings, logs, release selection and user workspaces live outside it.
- A deployment ref must resolve locally to a committed revision containing the scripts and host frontend entry; uncommitted edits are excluded and no fetch/pull/branch switch occurs.
- Development and deployment must keep separate encryption keys; the deployment key is required to read previously saved provider credentials.
- No TLS, public exposure, boot supervisor, automatic update or application-level schema change is introduced by this system.

## Subsystems

- [Local development lifecycle](local-dev/design.md) — the checkout-based backend/Vite pair and its environment file.
- [Host deployment lifecycle](host-deployment/design.md) — release export, build, selection, readiness, recovery and the frontend host.
- [Shared database lifecycle](shared-database/design.md) — the single MySQL service and development database provisioning.
