#!/usr/bin/env bash
# doltlite-compact — regular non-semantic Beads storage maintenance.
#
# Runs per .beads scope:
#   1. bd compact --force --days N
#   2. bd gc --skip-decay --force
#
# This intentionally skips bd gc's decay phase. It compacts commit history and
# reclaims storage without deleting closed issues.
set -euo pipefail

CITY="${GC_CITY_PATH:-${GC_CITY:-$(pwd -P)}}"
PACK_STATE_DIR="${GC_PACK_STATE_DIR:-${GC_CITY_RUNTIME_DIR:-$CITY/.gc/runtime}/packs/maintenance}"
LOCK="$PACK_STATE_DIR/doltlite-compact.lock"
THRESHOLD="${GC_BD_COMPACT_COMMIT_THRESHOLD:-500}"
DAYS="${GC_BD_COMPACT_DAYS:-0}"
COMPACT_TIMEOUT="${GC_BD_COMPACT_TIMEOUT:-1800s}"
GC_TIMEOUT="${GC_BD_GC_TIMEOUT:-600s}"
DRY_RUN="${GC_BD_COMPACT_DRY_RUN:-}"

if [ "${GC_STORE_SCOPE:-city}" = "rig" ]; then
    echo "doltlite-compact: skip rig-scoped duplicate; city order handles routed stores"
    exit 0
fi

mkdir -p "$PACK_STATE_DIR"
exec 9>"$LOCK"
if ! flock -n 9; then
    echo "doltlite-compact: already running"
    exit 0
fi

canon() {
    (cd "$1" 2>/dev/null && pwd -P) || return 1
}

add_root() {
    local root="$1"
    [ -n "$root" ] || return 0
    root="$(canon "$root")" || return 0
    [ -f "$root/.beads/metadata.json" ] || return 0
    case "
$ROOTS
" in
        *"
$root
"*) ;;
        *) ROOTS="${ROOTS}${root}
" ;;
    esac
}

ROOTS=""
add_root "$CITY"
if [ -n "${GC_STORE_ROOT:-}" ]; then
    add_root "$GC_STORE_ROOT"
fi

ROUTES="$CITY/.beads/routes.jsonl"
if [ -f "$ROUTES" ] && command -v jq >/dev/null 2>&1; then
    while IFS= read -r route_path; do
        [ -n "$route_path" ] || continue
        add_root "$CITY/$route_path"
    done < <(jq -r '.path // empty' "$ROUTES" 2>/dev/null || true)
fi

scopes=0
compacted=0
gc_ok=0
skipped=0
failed=0

while IFS= read -r root; do
    [ -n "$root" ] || continue
    scopes=$((scopes + 1))

    meta="$root/.beads/metadata.json"
    backend="$(jq -r '.backend // .database // empty' "$meta" 2>/dev/null || true)"
    case "$backend" in
        dolt|doltlite) ;;
        *)
            skipped=$((skipped + 1))
            echo "doltlite-compact: skip $root backend=${backend:-unknown}"
            continue
            ;;
    esac

    commits="$(
        cd "$root" &&
        BEADS_DIR="$root/.beads" timeout "$COMPACT_TIMEOUT" bd flatten --dry-run 2>/dev/null |
            awk '/Commits:/ {print $2; exit}'
    )" || commits=""
    commits="${commits:-0}"

    if ! [[ "$commits" =~ ^[0-9]+$ ]]; then
        failed=$((failed + 1))
        echo "doltlite-compact: failed to read commit count for $root"
        continue
    fi

    if [ "$commits" -lt "$THRESHOLD" ]; then
        skipped=$((skipped + 1))
        echo "doltlite-compact: skip $root commits=$commits threshold=$THRESHOLD"
        continue
    fi

    echo "doltlite-compact: compact $root commits=$commits days=$DAYS"
    if [ -n "$DRY_RUN" ]; then
        (
            cd "$root" &&
            BEADS_DIR="$root/.beads" bd compact --dry-run --days "$DAYS" &&
            BEADS_DIR="$root/.beads" bd gc --dry-run --skip-decay
        ) || failed=$((failed + 1))
        continue
    fi

    if (
        cd "$root" &&
        BEADS_DIR="$root/.beads" timeout "$COMPACT_TIMEOUT" bd compact --force --days "$DAYS" &&
        BEADS_DIR="$root/.beads" timeout "$GC_TIMEOUT" bd gc --skip-decay --force
    ); then
        compacted=$((compacted + 1))
        gc_ok=$((gc_ok + 1))
    else
        failed=$((failed + 1))
        echo "doltlite-compact: failed $root"
    fi
done <<< "$ROOTS"

echo "doltlite-compact: scopes=$scopes compacted=$compacted gc=$gc_ok skipped=$skipped failed=$failed"

if [ "$failed" -gt 0 ]; then
    exit 1
fi
