#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-4797}"
HOST="${HOST:-127.0.0.1}"

STATE_DIR="${OPENCLAW_STATE_DIR:-${CLAWDBOT_STATE_DIR:-$HOME/.openclaw}}"
TELEMETRY_DIR="${STATE_DIR%/}/evolve-my-claw"
PID_FILE="${PID_FILE:-$TELEMETRY_DIR/serve.pid}"
LOG_FILE="${LOG_FILE:-$TELEMETRY_DIR/serve.log}"

mkdir -p "$TELEMETRY_DIR"

if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
  if [ -n "${pids:-}" ]; then
    kill $pids || true
  fi
fi

if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${old_pid:-}" ] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" || true
  fi
fi

nohup node dist/cli.js serve --host "$HOST" --port "$PORT" --state-dir "$STATE_DIR" >>"$LOG_FILE" 2>&1 &
new_pid="$!"

echo "$new_pid" >"$PID_FILE"
disown "$new_pid" 2>/dev/null || true

echo "evolve-my-claw: started pid=$new_pid host=$HOST port=$PORT"
echo "evolve-my-claw: logs -> $LOG_FILE"
echo "evolve-my-claw: pid  -> $PID_FILE"
