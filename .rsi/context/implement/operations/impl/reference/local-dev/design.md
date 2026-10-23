> Existing behavior reference inside the aggregate implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

# Local development lifecycle

## Purpose and boundary

Run development from the project checkout independently of host deployment. Development owns its backend/frontend processes and configuration, and uses a separate database on shared MySQL.

## Inputs and preconditions

scripts/dev.sh supports init, start, stop, restart, status and logs [backend|frontend] from any directory. Node.js 22.19+, Docker Compose, curl/ps and installed backend/frontend dependencies are required. Defaults are loopback backend 3000 and Vite frontend 5273; occupied ports fail rather than moving or taking over unrelated processes.

## Outputs and observable effects

Project-root rsi.config.json owns development/deployment configuration, shared MySQL connection, ports and credentials. Initialization imports existing legacy files once without rewriting them or changing data; later commands read only the project config. Development retains its independent rsi_agent_dev account/key and data. Manual npm dev/start and reset commands use this same development configuration.

start ensures shared MySQL is healthy and the development database/account exists, then starts the development backend and Vite with readiness checks. The project configuration determines database/key, backend/frontend ports and proxy target. Inherited application variables and Node startup flags are excluded from managed child processes. No caller environment, shell profile, legacy env file or other service configuration is modified. Repeated healthy start creates no duplicate processes. stop stops only identified development processes and leaves shared MySQL/deployment running. restart stops/starts development. status reports database/application status without changing them; logs shows managed log tails. Existing two-line development PID records remain recognizable for a safe initial transition.

## Failure behavior

Missing dependencies, occupied ports, invalid database configuration or readiness failure are explicit nonzero failures. Newly started applications are stopped on failure; preexisting applications and shared MySQL remain. A stale/reused PID never causes an unrelated process to be signaled. Refuse concurrent lifecycle mutations. A failed or incomplete configuration transition preserves the original deployment settings and can be retried.

## Guarantees and limits

This command does not build deployment releases, install development packages, reset database contents or move registered workspace files. Provider credentials in the existing database remain available only in deployment; development starts with backend defaults. Explicit database infrastructure shutdown is separate. Starting an application never recreates an existing shared database container. Local readiness requests bypass shell HTTP proxy settings.

## Acceptance examples

Initialize with current data: deployment retains that database/key and development has a new independent key/database. Start both environments; each frontend reaches its own backend. Stop development repeatedly: deployment/MySQL remain available. A foreign process holding 5273 is left untouched and newly started development backend is stopped. Subsequent development restart preserves development data.

The environment's optional harnessPermissionsEnabled Boolean defaults to true. false disables runtime harness tool/path/sandbox/commit enforcement; true restores existing rules. Restart the backend after changes; no runtime toggle or member-file permission grant is provided. Launchers pass the value only to their own backend child.
