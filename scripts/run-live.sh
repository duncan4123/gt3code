#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

LIVE_WORKSPACE_SUFFIX="/.t3-dev/workspaces/t3code/live"

if [[ -z "${T3CODE_INSTALL_DIR:-}" && "$SCRIPT_ROOT" == *"$LIVE_WORKSPACE_SUFFIX" ]]; then
  INSTALL_DIR="${SCRIPT_ROOT%"$LIVE_WORKSPACE_SUFFIX"}"
  LIVE_DIR="$SCRIPT_ROOT"
else
  INSTALL_DIR="${T3CODE_INSTALL_DIR:-$SCRIPT_ROOT}"
  LIVE_DIR="${T3CODE_LIVE_DIR:-$INSTALL_DIR$LIVE_WORKSPACE_SUFFIX}"
fi

STATE_HOME="${T3CODE_STATE_HOME:-$INSTALL_DIR/.t3-dev}"

if [ ! -d "$LIVE_DIR" ]; then
  printf 't3code live checkout not found: %s\n' "$LIVE_DIR" >&2
  printf 'Create it first, for example: jj workspace add --name t3code-live -r live/current %s\n' "$LIVE_DIR" >&2
  exit 1
fi

mkdir -p "$STATE_HOME" "$STATE_HOME/worktrees" "$STATE_HOME/gascity"

export T3CODE_HOME="$STATE_HOME"
export T3_HOME="$STATE_HOME"
export T3CODE_WORKTREES_DIR="${T3CODE_WORKTREES_DIR:-$STATE_HOME/worktrees}"
export GC_WORKTREES_DIR="${GC_WORKTREES_DIR:-$T3CODE_WORKTREES_DIR}"
export T3CODE_GASCITY_HOME="${T3CODE_GASCITY_HOME:-$STATE_HOME/gascity}"
export GC_HOME="${GC_HOME:-$T3CODE_GASCITY_HOME}"
export GC_CITY_PATH="${GC_CITY_PATH:-$INSTALL_DIR/packages/gascity-config/config/cities/gastown}"

printf 'code:  %s\n' "$LIVE_DIR"
printf 'state: %s\n' "$T3CODE_HOME"
printf 'work:  %s\n' "$T3CODE_WORKTREES_DIR"

cd "$LIVE_DIR"
exec bun dev "$@"
