#!/usr/bin/env bash
set -euo pipefail

repo="${MCP_AGENT_MAIL_REPO:-/home/ubuntu/mcp_agent_mail}"
host="${MCP_AGENT_MAIL_HOST:-127.0.0.1}"
port="${MCP_AGENT_MAIL_PORT:-8765}"
run_root="${MCP_AGENT_MAIL_RUN_ROOT:-/tmp/gascity-mcp-agent-mail}"
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
  echo "mcp-agent-mail already listening on $host:$port"
  exit 0
fi

if [[ ! -d "$repo" ]]; then
  echo "mcp-agent-mail repo not found: $repo" >&2
  exit 1
fi

cd "$repo"

if [[ -z "${HTTP_BEARER_TOKEN:-}" && -f .env ]]; then
  HTTP_BEARER_TOKEN="$(grep -E '^HTTP_BEARER_TOKEN=' .env | sed -E 's/^HTTP_BEARER_TOKEN=//')" || true
  export HTTP_BEARER_TOKEN
fi

export HTTP_ALLOW_LOCALHOST_UNAUTHENTICATED="${HTTP_ALLOW_LOCALHOST_UNAUTHENTICATED:-true}"

if command -v setsid >/dev/null 2>&1; then
  setsid bash -c 'exec uv run python -m mcp_agent_mail.cli serve-http --host "$1" --port "$2"' \
    _ "$host" "$port" >"$log_file" 2>&1 &
else
  nohup uv run python -m mcp_agent_mail.cli serve-http --host "$host" --port "$port" \
    >"$log_file" 2>&1 &
fi
pid=$!
echo "$pid" >"$pid_file"

for _ in $(seq 1 50); do
  if port_open; then
    echo "mcp-agent-mail listening on $host:$port pid=$pid log=$log_file"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "mcp-agent-mail exited before listening; log=$log_file" >&2
    tail -40 "$log_file" >&2 || true
    exit 1
  fi
  sleep 0.2
done

echo "mcp-agent-mail did not listen on $host:$port; pid=$pid log=$log_file" >&2
exit 1
