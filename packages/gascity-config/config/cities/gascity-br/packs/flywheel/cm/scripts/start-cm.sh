#!/usr/bin/env bash
set -euo pipefail

host="${CM_HOST:-127.0.0.1}"
port="${CM_PORT:-8766}"
run_root="${CM_RUN_ROOT:-/tmp/gascity-cm}"
log_file="$run_root/server.log"
pid_file="$run_root/server.pid"

mkdir -p "$run_root"

port_open() {
  python3 - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket()
sock.settimeout(0.25)
try:
    sock.connect((host, port))
except OSError:
    sys.exit(1)
finally:
    sock.close()
PY
}

if port_open; then
  echo "cm already listening on $host:$port"
  exit 0
fi

if ! command -v cm >/dev/null 2>&1; then
  echo "cm not found on PATH" >&2
  exit 1
fi

if command -v setsid >/dev/null 2>&1; then
  setsid bash -c 'exec cm serve --host "$1" --port "$2"' _ "$host" "$port" >"$log_file" 2>&1 &
else
  nohup cm serve --host "$host" --port "$port" >"$log_file" 2>&1 &
fi
pid=$!
echo "$pid" >"$pid_file"

for _ in $(seq 1 50); do
  if port_open; then
    echo "cm listening on $host:$port pid=$pid log=$log_file"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "cm exited before listening; log=$log_file" >&2
    tail -40 "$log_file" >&2 || true
    exit 1
  fi
  sleep 0.2
done

echo "cm did not listen on $host:$port; pid=$pid log=$log_file" >&2
exit 1
