#!/usr/bin/env bash
# http-ping.sh — Simple HTTP ping check script
# Usage: ./scripts/http-ping.sh <url> [--interval <seconds>] [--count <n>]
#
# Sends HTTP HEAD requests to the given URL and reports status.

set -euo pipefail

URL=""
INTERVAL=5
COUNT=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval|-i)
      INTERVAL="$2"
      shift 2
      ;;
    --count|-c)
      COUNT="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 <url> [--interval <seconds>] [--count <n>]"
      echo ""
      echo "Options:"
      echo "  --interval, -i  Seconds between pings (default: 5)"
      echo "  --count, -c     Number of pings, 0 for infinite (default: 1)"
      echo "  --help, -h      Show this help"
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      URL="$1"
      shift
      ;;
  esac
done

if [[ -z "$URL" ]]; then
  echo "Error: URL is required" >&2
  echo "Usage: $0 <url> [--interval <seconds>] [--count <n>]" >&2
  exit 1
fi

ping_url() {
  local start end elapsed http_code
  start=$(date +%s%N 2>/dev/null || date +%s)

  http_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -L "$URL" 2>/dev/null) || http_code="000"

  end=$(date +%s%N 2>/dev/null || date +%s)

  # Calculate elapsed in ms (fallback to seconds if %N not supported)
  if [[ "$start" =~ ^[0-9]{10,}$ ]]; then
    elapsed=$(( (end - start) / 1000000 ))
    elapsed_str="${elapsed}ms"
  else
    elapsed=$(( end - start ))
    elapsed_str="${elapsed}s"
  fi

  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')

  if [[ "$http_code" == "000" ]]; then
    echo "[$timestamp] FAIL $URL — connection error (${elapsed_str})"
    return 1
  elif [[ "$http_code" -ge 200 && "$http_code" -lt 400 ]]; then
    echo "[$timestamp]   OK $URL — HTTP $http_code (${elapsed_str})"
    return 0
  else
    echo "[$timestamp] WARN $URL — HTTP $http_code (${elapsed_str})"
    return 0
  fi
}

echo "Pinging $URL (interval=${INTERVAL}s, count=${COUNT})"
echo "---"

i=0
failures=0
while true; do
  ping_url || failures=$((failures + 1))
  i=$((i + 1))

  if [[ "$COUNT" -gt 0 && "$i" -ge "$COUNT" ]]; then
    break
  fi

  sleep "$INTERVAL"
done

echo "---"
echo "Done: $i pings, $failures failed"
exit $( [[ "$failures" -eq 0 ]] && echo 0 || echo 1 )
