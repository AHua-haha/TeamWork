<!-- Task proposal; current contract is under docs/systems/ -->
# Local development lifecycle implementation

## Contract

[Proposed lifecycle design](design.md). The key guarantees are repeatable start/stop, readiness before success, and stopping only identified managed processes.

## Responsibilities and decomposition

The shell script owns local orchestration. Docker Compose supplies MySQL; direct Node processes run the backend and Vite. Backend and frontend packages continue to own their own application behavior.

## Coordination and data flow

Startup checks tools and installed dependencies, creates the environment file if needed, adds a generated `CONFIG_ENCRYPTION_KEY` if absent from both file and process environment, then starts the database, backend, and frontend in dependency order. Each process writes its PID, process start time, and log under an ignored runtime directory. A PID is accepted only while its start time and command line still identify the expected application entry point. Readiness probes check the backend agent-list endpoint and frontend root page. They call `curl` with `--noproxy '*'`, because a shell's `http_proxy` would otherwise send these loopback requests to the proxy, which answers them with its own error. When a probe times out, the script prints the response the URL gives before the log tail. Shutdown sends termination to identified processes in reverse order and stops the database only when an ownership marker says this script started it.

## Decisions and constraints

Ports are fixed to the documented loopback development URLs, with the frontend port defined once in the script as `frontend_port` (5273), so Vite cannot silently move to another port. `npm run dev` in `frontend/` is separate from this script and keeps Vite's default. The script does not run `npm ci`; missing dependencies are reported with the commands to install them. Docker data remains across stops. The example backend environment file is copied only when missing.

## Code map

- [scripts/dev.sh](../../../../../scripts/dev.sh): entry point for start, stop, and status.
- [.gitignore](../../../../../.gitignore): excludes process IDs and logs.
- [README.md](../../../../../README.md): complete-stack commands.
- [backend/README.md](../../../../../backend/README.md): developer commands.

## Verification

Shell syntax, a real start/status/repeated-start/stop/repeated-stop cycle, backend and frontend HTTP readiness, process identity, Docker ownership, and cleanup are recorded in the [config-system task's log](../../../2026-09-30-config-system/tests.jsonl). The proxy and port changes are recorded in this task's [verification log](../../tests.jsonl).
