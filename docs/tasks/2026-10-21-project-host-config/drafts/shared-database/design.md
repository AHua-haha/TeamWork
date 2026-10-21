<!-- Task proposal; current contract is under docs/systems/ -->
# Shared local database lifecycle

## Purpose and boundary

Provide one local MySQL service to separate development/deployment databases. This system owns infrastructure lifecycle and development database provisioning, not application schemas or records.

## Inputs and preconditions

scripts/database.sh supports start, stop and status. Docker Compose is available; backend/compose.yaml is a structural template; all its operator inputs come from project-root rsi.config.json. The existing backend project identity, MySQL 8.4 service and named volume are retained; the shared loopback host/port, root/account credentials and Docker context are explicit config fields. Both application environments connect to this server. Deployment uses existing rsi_agent with existing credentials. Development uses a distinct rsi_agent_dev and local rsi_dev account restricted to that database.

## Outputs and observable effects

start ensures the shared service is healthy. Development provisioning creates rsi_agent_dev and grants its account access without touching deployment data; repeated provisioning retains development data. Application start may ensure infrastructure is running, but application stop/failure leaves it running. Only explicit database.sh stop stops the service, keeping its volume/data. status is read-only. Development configuration is initialized separately before provisioned SQL is used.

## Failure behavior

Docker/service health, provisioning or credential errors fail explicitly. No down -v, drop database, truncate, reset-data or deployment password/key rotation is performed. Invalid development database/account configuration fails before SQL changes. A failed startup does not stop the shared service that the other environment may use.

## Guarantees and limits

Existing Compose project/container/volume identity remains stable. Provisioning is local container administration using the container's existing root password without logging it or placing it on process arguments. Database/account separation does not copy workspace files. Users must stop applications before intentionally stopping the shared service.

## Acceptance examples

Both backends run on distinct databases in the same healthy MySQL container. Repeated starts preserve both sets of data. Stopping either application leaves MySQL available. Explicit database stop preserves the volume, and start restores access.

Compose uses an explicit project, file, project directory, empty env-file and configured Docker context with a clean child environment. Ambient Compose/Docker/database variables and nearby .env files cannot change the targeted service. No Docker global context/settings or shell environment is changed.
