#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec env -u NODE_OPTIONS -u NODE_PATH node "$root/scripts/desktop.mjs" "$@"
