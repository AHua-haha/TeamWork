#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_dir="$root/.run"
compose_file="$root/backend/compose.yaml"
backend_pid="$run_dir/backend.pid"
frontend_pid="$run_dir/frontend.pid"
mysql_owned="$run_dir/mysql.started"
backend_entry="$root/backend/src/main.ts"
frontend_entry="$root/frontend/node_modules/vite/bin/vite.js"
backend_url='http://127.0.0.1:3000/agents'
frontend_url='http://127.0.0.1:5173/'
started_mysql=0
started_backend=0
started_frontend=0

usage() {
  echo "Usage: $0 {start|stop|status}" >&2
  exit 2
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    return 1
  fi
}

compose() { docker compose -f "$compose_file" "$@"; }

mysql_running() {
  [[ "$(compose ps --status running --services mysql 2>/dev/null)" == mysql ]]
}

owned_process() {
  local file="$1" marker="$2" pid recorded_start actual_start command_line
  [[ -r "$file" ]] || return 1
  { IFS= read -r pid && IFS= read -r recorded_start; } <"$file" || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [[ -n "$recorded_start" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  actual_start="$(ps -p "$pid" -o lstart= 2>/dev/null || true)"
  [[ "$actual_start" == "$recorded_start" ]] || return 1
  command_line="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command_line" == *"$marker"* ]]
}

record_process() {
  local pid="$1" file="$2" start
  start="$(ps -p "$pid" -o lstart= 2>/dev/null)" || return 1
  [[ -n "$start" ]] || return 1
  printf '%s\n%s\n' "$pid" "$start" >"$file"
}

recorded_pid() {
  local pid
  IFS= read -r pid <"$1"
  echo "$pid"
}

port_available() {
  node -e 'const net = require("node:net"); const server = net.createServer(); server.once("error", () => process.exit(1)); server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close());' "$1"
}

ready() { curl --silent --show-error --fail --max-time 1 "$1" >/dev/null 2>&1; }

wait_ready() {
  local name="$1" url="$2" file="$3" marker="$4" log="$5" attempt
  for ((attempt = 0; attempt < 80; attempt++)); do
    if ! owned_process "$file" "$marker"; then
      echo "$name exited before it became ready. Recent log output:" >&2
      tail -n 30 "$log" >&2 || true
      rm -f "$file"
      return 1
    fi
    if ready "$url"; then return 0; fi
    sleep 0.25
  done
  echo "$name did not become ready at $url. Recent log output:" >&2
  tail -n 30 "$log" >&2 || true
  return 1
}

start_mysql() {
  if mysql_running; then
    echo 'MySQL is already running; waiting for health...'
    compose up -d --wait mysql || return 1
  else
    echo 'Starting MySQL...'
    started_mysql=1
    touch "$mysql_owned" || return 1
    compose up -d --wait mysql || return 1
  fi
}

start_backend() {
  if owned_process "$backend_pid" "$backend_entry"; then
    if ready "$backend_url"; then echo 'Backend is already running.'; return 0; fi
    echo "Managed backend is running but not responding at $backend_url." >&2
    return 1
  fi
  rm -f "$backend_pid"
  if ! port_available 3000; then echo 'Port 3000 is in use by another process.' >&2; return 1; fi
  echo 'Starting backend...'
  (
    cd "$root/backend" || exit 1
    nohup env HOST=127.0.0.1 PORT=3000 node --env-file-if-exists=.env --import tsx "$backend_entry" >>"$run_dir/backend.log" 2>&1 </dev/null &
    child_pid=$!
    if ! record_process "$child_pid" "$backend_pid"; then
      kill -TERM "$child_pid" 2>/dev/null || true
      exit 1
    fi
  ) || return 1
  started_backend=1
  wait_ready Backend "$backend_url" "$backend_pid" "$backend_entry" "$run_dir/backend.log"
}

start_frontend() {
  if owned_process "$frontend_pid" "$frontend_entry"; then
    if ready "$frontend_url"; then echo 'Frontend is already running.'; return 0; fi
    echo "Managed frontend is running but not responding at $frontend_url." >&2
    return 1
  fi
  rm -f "$frontend_pid"
  if ! port_available 5173; then echo 'Port 5173 is in use by another process.' >&2; return 1; fi
  echo 'Starting frontend...'
  (
    cd "$root/frontend" || exit 1
    nohup env AGENT_BACKEND_ORIGIN=http://127.0.0.1:3000 node "$frontend_entry" --host 127.0.0.1 --port 5173 --strictPort >>"$run_dir/frontend.log" 2>&1 </dev/null &
    child_pid=$!
    if ! record_process "$child_pid" "$frontend_pid"; then
      kill -TERM "$child_pid" 2>/dev/null || true
      exit 1
    fi
  ) || return 1
  started_frontend=1
  wait_ready Frontend "$frontend_url" "$frontend_pid" "$frontend_entry" "$run_dir/frontend.log"
}

stop_process() {
  local name="$1" file="$2" marker="$3" pid attempt
  if ! owned_process "$file" "$marker"; then
    [[ ! -e "$file" ]] || echo "$name has a stale PID file; removing it."
    rm -f "$file"
    return 0
  fi
  pid="$(recorded_pid "$file")"
  echo "Stopping $name (PID $pid)..."
  if ! kill -TERM "$pid"; then
    echo "Could not signal $name (PID $pid)." >&2
    return 1
  fi
  for ((attempt = 0; attempt < 40; attempt++)); do
    if ! owned_process "$file" "$marker"; then rm -f "$file"; return 0; fi
    sleep 0.25
  done
  if owned_process "$file" "$marker"; then kill -KILL "$pid" || return 1; fi
  for ((attempt = 0; attempt < 20; attempt++)); do
    if ! owned_process "$file" "$marker"; then rm -f "$file"; return 0; fi
    sleep 0.25
  done
  echo "Could not stop $name (PID $pid)." >&2
  return 1
}

stop_mysql() {
  [[ -f "$mysql_owned" ]] || return 0
  echo 'Stopping script-managed MySQL (data is preserved)...'
  compose stop mysql || return 1
  rm -f "$mysql_owned" || return 1
}

rollback() {
  if ((started_frontend)); then stop_process Frontend "$frontend_pid" "$frontend_entry" || true; fi
  if ((started_backend)); then stop_process Backend "$backend_pid" "$backend_entry" || true; fi
  if ((started_mysql)); then stop_mysql || true; fi
}

start() {
  need docker
  need node
  need curl
  need ps
  need grep
  docker compose version >/dev/null
  [[ -e "$root/backend/node_modules/tsx" ]] || { echo 'Install backend dependencies: cd backend && npm ci' >&2; return 1; }
  [[ -f "$frontend_entry" ]] || { echo 'Install frontend dependencies: cd frontend && npm ci' >&2; return 1; }
  mkdir -p "$run_dir"
  if [[ ! -f "$root/backend/.env" ]]; then
    cp "$root/backend/.env.example" "$root/backend/.env" || return 1
    echo 'Created backend/.env from the local example; add provider credentials there for model calls.'
  fi
  if [[ -z "${CONFIG_ENCRYPTION_KEY:-}" ]] && ! grep -q '^CONFIG_ENCRYPTION_KEY=' "$root/backend/.env"; then
    printf 'CONFIG_ENCRYPTION_KEY=%s\n' "$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')" >>"$root/backend/.env"
    echo 'Generated a local config encryption key in backend/.env.'
  fi
  if ! start_mysql || ! start_backend || ! start_frontend; then
    rollback
    return 1
  fi
  echo "Frontend: http://127.0.0.1:5173/"
  echo "Backend:  http://127.0.0.1:3000/agents"
  echo "Logs:     $run_dir/backend.log and $run_dir/frontend.log"
}

stop() {
  local failed=0
  stop_process Frontend "$frontend_pid" "$frontend_entry" || failed=1
  stop_process Backend "$backend_pid" "$backend_entry" || failed=1
  if [[ -f "$mysql_owned" ]]; then
    need docker || failed=1
    if ((failed == 0)); then stop_mysql || failed=1; fi
  fi
  if ((failed == 0)); then echo 'Local services stopped.'; fi
  return "$failed"
}

status() {
  need docker
  docker compose version >/dev/null
  if mysql_running; then
    if [[ -f "$mysql_owned" ]]; then echo 'MySQL: running (script-managed)'; else echo 'MySQL: running (external)'; fi
  else echo 'MySQL: stopped'; fi
  if owned_process "$backend_pid" "$backend_entry"; then echo "Backend: running (PID $(recorded_pid "$backend_pid"))"; else echo 'Backend: stopped'; fi
  if owned_process "$frontend_pid" "$frontend_entry"; then echo "Frontend: running (PID $(recorded_pid "$frontend_pid"))"; else echo 'Frontend: stopped'; fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) usage ;;
esac
