#!/usr/bin/env bash
#
# Stop processes listening on DevDigest's local web/API ports.
#
#   ./scripts/stop-dev.sh
#
# Postgres is intentionally left running.

set -euo pipefail

PORTS=(3000 3001)

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

command -v lsof >/dev/null || { echo "lsof not found"; exit 1; }

listener_pids() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
}

stopped=0
for port in "${PORTS[@]}"; do
  pids="$(listener_pids "$port")"
  if [ -z "$pids" ]; then
    log "port :$port is free"
    continue
  fi

  warn "stopping listener(s) on :$port"
  ps -o pid=,command= -p "$(printf '%s\n' "$pids" | paste -sd, -)" || true
  while IFS= read -r pid; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done <<< "$pids"
  stopped=1
done

# Give well-behaved servers five seconds to shut down cleanly.
if [ "$stopped" -eq 1 ]; then
  for _ in $(seq 1 20); do
    busy=0
    for port in "${PORTS[@]}"; do
      [ -n "$(listener_pids "$port")" ] && busy=1
    done
    [ "$busy" -eq 0 ] && break
    sleep 0.25
  done
fi

# Next.js can leave next-server alive after SIGTERM. Force-stop any listener
# that remains (including one respawned under a new PID).
for port in "${PORTS[@]}"; do
  pids="$(listener_pids "$port")"
  if [ -n "$pids" ]; then
    warn "listener(s) on :$port did not stop; sending SIGKILL"
    ps -o pid=,command= -p "$(printf '%s\n' "$pids" | paste -sd, -)" || true
    while IFS= read -r pid; do
      [ -n "$pid" ] && kill -KILL "$pid" 2>/dev/null || true
    done <<< "$pids"
  fi
done

sleep 0.25
for port in "${PORTS[@]}"; do
  [ -z "$(listener_pids "$port")" ] || {
    echo "port :$port is still in use after SIGKILL" >&2
    exit 1
  }
done

log "DevDigest ports are free; run ./scripts/dev.sh"
