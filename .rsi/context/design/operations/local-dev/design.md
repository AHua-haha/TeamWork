# Local development lifecycle

## Purpose, responsibilities and boundaries

Run development from the project checkout independently of host deployment. Development owns its backend/frontend processes and configuration, and uses a separate database on shared MySQL.

## Interface contract

scripts/dev.sh supports init, start, stop, restart, status and logs [backend|frontend] from any directory. Node.js 22.19+, Docker Compose, curl/ps and installed backend/frontend dependencies are required. Defaults are loopback backend 3000 and Vite frontend 5273; occupied ports fail rather than moving or taking over unrelated processes.


First initialization preserves the current backend/.env and existing encryption key for deployment outside the temporary source tree. Development backend/.env is then initialized for the new rsi_agent_dev database with an independent key and no copied provider connections/workspaces/chats. Future starts preserve development data/configuration. No database is cleared to simulate emptiness. Direct backend dev/start commands read this development environment file.

start ensures shared MySQL is healthy and the development database/account exists, then starts the development backend and Vite with readiness checks. Environment-specific file settings determine database/key rather than an accidentally inherited DATABASE_URL. Repeated healthy start creates no duplicate processes. stop stops only identified development processes and leaves shared MySQL/deployment running. restart stops/starts development. status reports database/application status without changing them; logs shows managed log tails. Existing two-line development PID records remain recognizable for a safe initial transition.


Missing dependencies, occupied ports, invalid database configuration or readiness failure are explicit nonzero failures. Newly started applications are stopped on failure; preexisting applications and shared MySQL remain. A stale/reused PID never causes an unrelated process to be signaled. Refuse concurrent lifecycle mutations. A failed or incomplete configuration transition preserves the original deployment settings and can be retried.


This command does not build deployment releases, install development packages, reset database contents or move registered workspace files. Provider credentials in the existing database remain available only in deployment; development starts with backend defaults. Explicit database infrastructure shutdown is separate. Local readiness requests bypass shell HTTP proxy settings.

## Constraints, specifications and requirements

Initialize with current data: deployment retains that database/key and development has a new independent key/database. Start both environments; each frontend reaches its own backend. Stop development repeatedly: deployment/MySQL remain available. A foreign process holding 5273 is left untouched and newly started development backend is stopped. Subsequent development restart preserves development data.
