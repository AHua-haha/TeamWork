# Operations

## Purpose, responsibilities and boundaries

Operations owns project environment management and lifecycle: development environment setup, required toolchain/dependency installation, development launch configuration and processes, deployment build/release/process management, and supporting database-service initialization and lifecycle. Backend Core owns application records/schema; Storage owns application database access. Operations manages database service infrastructure and connection configuration, but does not interpret or migrate application business data.

## Interface contract

Project configuration is aggregated in one private `rsi.config.json` file. It is the single source for project-level application, development, deployment, environment/toolchain/dependency, and supporting database-service settings; commands do not require a second private configuration file or hidden configuration source. Environment-specific values remain grouped and isolated within that file, and commands keep settings in child processes, preserve caller/global environment and refuse unrelated occupied ports/processes. Operations owns setup and documented installation/verification of the development toolchain and dependencies, using the project’s declared dependency manifests and lockfiles rather than inventing unpinned alternatives. Each environment accepts one optional positive safe-integer contextCompactionThresholdTokens, default 64,000. The same value controls both Agent checkpoints; do not couple it to per-model stored contextBudget or add separate trigger thresholds.

Operations owns the development environment lifecycle, including setup, dependency readiness, initialization and configuration of this project's isolated development database service, plus explicit service start/stop/status operations. The development service uses a project-specific Compose identity, storage volume, network and credentials; it must not reuse, stop, reset or mutate another project's service or data. Its host port is explicitly configured by this project's private configuration and checked for conflicts. Existing database services remain untouched. Development application configuration points only to this project-owned service. Database service management does not interpret or migrate application business data.

Development and deployment settings and databases remain separately configurable. Project commands manage development and committed host deployment. Deployment builds an exported local commit before switching app processes, preserves the current release on build failure and attempts recovery on launch failure. Stopping an app preserves its database service/data. Existing old compiled release entries remain startable for recovery after source migration. No data reset/copy, infrastructure rewrite or live deployment update is part of source reorganization.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
