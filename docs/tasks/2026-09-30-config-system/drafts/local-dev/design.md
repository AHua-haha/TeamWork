<!-- Task proposal; current contract is under docs/systems/ -->

# Local development lifecycle

## Purpose and boundary

A developer can start, inspect, and stop the local MySQL, backend, and frontend used to review this project through one command. This facility manages only local development processes it starts. It does not deploy the application or change agent configuration.

## Inputs and preconditions

- The command accepts `start`, `stop`, or `status` from any working directory.
- Docker with Compose, Node.js, curl, and installed backend/frontend dependencies are available. The project provides a local database example and a backend environment example.
- The backend and frontend use local loopback ports 3000 and 5173. A conflicting process on either port prevents startup; the command does not take ownership of that process.

## Outputs and observable effects

- `start` makes the local database healthy, starts the backend, waits for its API to respond, then starts the frontend and waits for its page to respond. It prints the frontend URL and log locations. Repeating `start` with the managed services already healthy is safe and does not start duplicates.
- If the backend environment file is absent, `start` copies the provided local example once. It does not overwrite an existing file. When neither the process environment nor that file supplies `CONFIG_ENCRYPTION_KEY`, `start` adds a generated key to the file so editable provider credentials can be saved. Provider credentials remain for the developer to supply when model calls are needed.
- `status` reports whether each managed application process is running and whether the local database is running. It does not change their state.
- `stop` stops the managed frontend and backend, then stops the database only if the script started it. It keeps database data and logs. Repeating `stop` is safe. An unrelated manually started process is never stopped based only on its port.
- Process IDs and logs are stored outside tracked source files for inspection between commands.

## Failure behavior

- Missing dependencies, occupied ports, database startup failure, or an application that does not become ready produce a nonzero exit and a useful diagnostic. An application newly started by the failed invocation is stopped. A database newly started by that invocation is stopped. Previously running services are left as they were.
- A stale process ID does not cause an unrelated process to be signaled. `stop` removes stale ownership records without killing another process.
- `stop` reports a failed shutdown instead of claiming success if a managed service cannot be stopped.

## Guarantees and limits

- The script manages one local backend and frontend pair on the documented ports. It does not install packages or manage production processes.
- Stopping MySQL preserves its Docker volume. The developer may remove it separately if desired.
- Readiness checks confirm that the documented local API and frontend URL respond; they do not confirm provider credentials or a successful live model call.

## Acceptance examples

1. With dependencies installed and Docker available, `start` returns after both URLs respond; `status` reports all three services running.
2. A second `start` leaves the same managed process IDs in place.
3. `stop` ends the managed application processes and the MySQL container it started, without deleting the database volume. A second `stop` succeeds.
4. Port 5173 is used by an unrelated server. `start` reports the conflict, stops the backend and MySQL it just started, and leaves that server running.
