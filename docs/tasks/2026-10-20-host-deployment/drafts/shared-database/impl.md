<!-- Task proposal; current contract is under docs/systems/ -->
# Shared database lifecycle implementation

## Contract

[Shared database design](design.md). Preserve deployment data and the existing volume; application stop never stops shared infrastructure.

## Responsibilities and decomposition

The shared script owns Docker Compose lifecycle. Provisioning adds a dedicated development database/account; the backend still owns per-database schema initialization and runtime locks.

## Coordination and data flow

The database wrapper invokes database.mjs. All Compose calls explicitly use -p backend and the existing backend/compose.yaml so running from a temporary release or another directory cannot create another service/volume. up -d --wait mysql ensures health. stop mysql preserves the volume. Status queries running services without mutation. Development startup invokes provisioning after configuration validation: create rsi_agent_dev if absent, create/update local rsi_dev credentials, grant only rsi_agent_dev.*. SQL uses stdin to docker compose exec -T; the container's root password is read from its existing environment via MYSQL_PWD rather than passed on process arguments. No production password/grant/data mutation occurs. Existing database/Compose files are not recreated.

## Decisions and constraints

The deployment URL names rsi_agent, the development URL names rsi_agent_dev on the same host/port, development uses the dedicated account and keys must differ. The local provisioning password allows letters/digits/_/- to keep its fixed-purpose SQL unambiguous. Repeated startup never clears either database. Explicit database stop may interrupt both applications; users stop apps first.

## Code map

- [Database wrapper](../../../scripts/database.sh) and [implementation](../../../scripts/database.mjs).
- [Shared settings validation](../../../scripts/host-common.mjs).
- [Existing service/volume](../../../backend/compose.yaml) and [development defaults](../../../backend/.env.example).

## Verification

Isolated lifecycle tests mock Docker without touching live data. Actual server checks compare preserved deployment records/key fingerprints before/after transition, verify initially empty development workspaces/provider connections, verify development account isolation and prove development stop leaves deployment/MySQL live. Test evidence is recorded in the host-deployment task.
