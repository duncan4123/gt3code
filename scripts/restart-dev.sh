#!/usr/bin/env bash
# Restart T3 dev server and web app.
# Kills any existing processes on T3 ports, then starts both together
# via `bun run dev` so the dev-runner can wire ports/env correctly.
set -euo pipefail

TMUX_BIN="${TMUX_BIN:-/usr/bin/tmux}"
SESSION="${T3_TMUX_SESSION:-mayor}"
DEV_WINDOW="t3-dev"
T3_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Kill whatever process is listening on a port
kill_port() {
  local port="$1"
  local pids
  pids=$(ss -tlnp "sport = :$port" 2>/dev/null | awk 'NR>1 {match($0,/pid=([0-9]+)/,a); if(a[1]) print a[1]}')
  if [ -n "$pids" ]; then
    echo "Killing process(es) on port $port: $pids"
    echo "$pids" | xargs kill 2>/dev/null || true
  fi
}

# Kill old per-service windows if they exist
for window in t3-server t3-web "$DEV_WINDOW"; do
  if $TMUX_BIN list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qx "$window"; then
    echo "Stopping $window..."
    $TMUX_BIN kill-window -t "$SESSION:$window"
  fi
done

# Kill any processes on T3 server ports
kill_port 3773
kill_port 3774
kill_port 5733
kill_port 5734
sleep 1

# Start both together so dev-runner wires VITE_WS_URL correctly
echo "Starting t3-dev..."
$TMUX_BIN new-window -t "$SESSION" -n "$DEV_WINDOW" -c "$T3_DIR"
$TMUX_BIN send-keys -t "$SESSION:$DEV_WINDOW" "bun run dev" Enter

echo "T3 dev restarting in tmux window '$DEV_WINDOW' (session '$SESSION')."
