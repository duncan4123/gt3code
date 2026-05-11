# GC Sidebar Clean Reset Playbook

Use this playbook to test the T3 sidebar from a clean T3Code app state while
keeping Gas City workspace data intact unless a broader reset is explicitly
needed.

Durable fixes belong in repo code/config. Runtime files should be regenerated
from source on restart.

## Non-Negotiables

- Do not create backups as part of this reset.
- Do not use stock `sqlite3` on T3Code or Doltlite DBs.
- Do not delete city workspace Beads DBs for a normal sidebar reset. Examples:
  `gastown/.beads/doltlite/hq.db`, `gascity-br/.beads/beads.db`, or any other
  DB declared by a city's `.beads/metadata.json`.
- Stop the T3 app and all GC controllers before deleting files.
- Stop the T3 app and all GC controllers before starting again. Never start a
  new app/runtime on top of stale controller processes.
- Keep source-controlled config, packs, templates, and code.
- Keep `/home/ubuntu/.local/state/t3code/gascity/current/bin` unless rebuilding
  GC/BD binaries.
- Use `docs/t3code-db-playbook.md` for any DB inspection.

## Reset Scopes

Default for sidebar testing:

| Scope | Deletes | Keeps |
| --- | --- | --- |
| T3Code app reset | `~/.t3/*/state*.sqlite`, app runtime caches/logs/worktrees | GC workspace Beads DBs |
| GC process runtime reset | supervisor/controller sockets, logs, generated `.gc` workdirs | city workspace Beads DBs, source config |
| Session-bead scrub | `issue_type='session'` / `gc:session` rows inside each city workspace DB | DB files and non-session beads |

Only run the full Beads rebuild section when you explicitly want cities to
recreate their Beads storage from scratch.

## Paths

T3Code app DBs:

```text
/home/ubuntu/.t3/dev/state.sqlite
/home/ubuntu/.t3/dev/state-proj.sqlite
/home/ubuntu/.t3/userdata/state.sqlite
/home/ubuntu/.t3/userdata/state-proj.sqlite
```

Machine-local GC runtime generated from T3Code settings and city TOMLs:

```text
/home/ubuntu/.local/state/t3code/gascity/current
```

Typical contents:

```text
current/bin/                 # copied gc/bd/libdoltlite binaries; keep unless rebuilding
current/cities.toml          # generated city registry
current/supervisor.toml      # generated supervisor config/state
current/supervisor.sock
current/supervisor.log
current/events.jsonl
current/city/                # legacy/materialized city runtime if created
```

Packaged city roots:

```text
packages/gascity-config/config/cities/gastown
packages/gascity-config/config/cities/gascity-br
```

Per-city runtime generated from city TOMLs:

```text
packages/gascity-config/config/cities/<city>/.gc/system/packs/
packages/gascity-config/config/cities/<city>/.gc/runtime/
packages/gascity-config/config/cities/<city>/.gc/runtime/packs/
packages/gascity-config/config/cities/<city>/.gc/agents/
packages/gascity-config/config/cities/<city>/.gc/worktrees/
packages/gascity-config/config/cities/<city>/.gc/services/
packages/gascity-config/config/cities/<city>/.gc/nudges/
packages/gascity-config/config/cities/<city>/.gc/cache/
packages/gascity-config/config/cities/<city>/.gc/session-name-locks/
packages/gascity-config/config/cities/<city>/.gc/events.jsonl
```

City workspace Beads data is adjacent but is not the same as generated `.gc`
runtime:

```text
packages/gascity-config/config/cities/<city>/.beads/
packages/gascity-config/config/cities/<city>/rigs/<rig>/.beads/
```

Do not assume there are only two cities or that every city DB is named `hq.db`.
Discover cities from `packages/gascity-config/config/cities/*` and discover
workspace DBs from each city's `.beads` metadata/files.

## Stop Runtime

This is required before deletion and before restart. Run from anywhere:

```bash
pkill -TERM -f 'scripts/dev-runner.ts|turbo run dev|node --watch src/bin.ts|apps/web/node_modules/.bin/vite|codex app-server' || true
pkill -TERM -f '/home/ubuntu/.local/state/t3code/gascity/current/bin/gc supervisor run' || true
pkill -TERM -f 'agent-browser|agent-browser-chrome' || true
sleep 2
pkill -KILL -f '/home/ubuntu/.local/state/t3code/gascity/current/bin/gc supervisor run|codex app-server' || true
```

Verify:

```bash
pgrep -af '/home/ubuntu/.local/state/t3code/gascity/current/bin/(gc|bd)|codex app-server|scripts/dev-runner.ts|vite|turbo run dev|node --watch src/bin.ts' || true
```

The only output should be the `pgrep` command itself, or no output. If any app,
supervisor, controller, or provider process remains, stop it before continuing.

## Default Reset: T3Code App State

This is the normal reset for sidebar testing.

```bash
rm -rf \
  /home/ubuntu/.t3/dev/state.sqlite* \
  /home/ubuntu/.t3/dev/state-proj.sqlite* \
  /home/ubuntu/.t3/dev/server-runtime.json \
  /home/ubuntu/.t3/dev/logs \
  /home/ubuntu/.t3/dev/attachments \
  /home/ubuntu/.t3/userdata/state.sqlite* \
  /home/ubuntu/.t3/userdata/state-proj.sqlite* \
  /home/ubuntu/.t3/userdata/server-runtime.json \
  /home/ubuntu/.t3/userdata/logs \
  /home/ubuntu/.t3/userdata/attachments \
  /home/ubuntu/.t3/caches \
  /home/ubuntu/.t3/worktrees
```

Verify no app DBs remain:

```bash
find /home/ubuntu/.t3 -maxdepth 3 \
  \( -name 'state.sqlite' -o -name 'state-proj.sqlite' -o -name '*.sqlite-wal' -o -name '*.sqlite-shm' \) \
  -print 2>/dev/null
```

Expected output: empty.

## Optional: GC Process Runtime Reset

Use when the supervisor/controller/runtime state may be stale. This does not
delete workspace Beads DBs.

```bash
find /home/ubuntu/.local/state/t3code/gascity/current \
  -mindepth 1 -maxdepth 1 ! -name bin -exec rm -rf {} +

rm -rf \
  packages/gascity-config/config/.gc/agents \
  packages/gascity-config/config/.gc/worktrees \
  packages/gascity-config/config/.gc/events.jsonl

for city in packages/gascity-config/config/cities/*; do
  [ -d "$city" ] || continue
  rm -rf \
    "$city/.gc/agents" \
    "$city/.gc/worktrees" \
    "$city/.gc/runtime" \
    "$city/.gc/cache" \
    "$city/.gc/nudges" \
    "$city/.gc/services" \
    "$city/.gc/session-name-locks" \
    "$city/.gc/tmp" \
    "$city/.gc/br-artifact-backup" \
    "$city/.gc/events.jsonl"
done
```

Verify only binaries remain in the runtime home:

```bash
find /home/ubuntu/.local/state/t3code/gascity/current -mindepth 1 -maxdepth 1 -print 2>/dev/null | sort
```

Expected output for a clean runtime home:

```text
/home/ubuntu/.local/state/t3code/gascity/current/bin
```

## Session-Bead Scrub For City Workspace DBs

Use this when you need to remove stale GC sessions while preserving the
workspace DBs and all non-session beads.

This script discovers DB files under every configured city root and mutates only
DBs with Beads-style `issues` and `labels` tables. It deletes:

- `issues.issue_type = 'session'`
- rows labelled `gc:session`
- dependent rows in comments, labels, events, dependencies, snapshots, and wisp
  mirror tables

Run from repo root:

```bash
cd /data/projects/t3code/apps/server

mapfile -t dbs < <(
  find /data/projects/t3code/packages/gascity-config/config/cities \
    /home/ubuntu/.local/state/t3code \
    /home/ubuntu/.t3 \
    \( -path '*/node_modules/*' -o -path '*/sample_beads_db_files/*' \) -prune -o \
    \( -path '*/.beads/*.db' -o -path '*/.beads/doltlite/*.db' -o -path '*/.beads/embeddeddolt/*/*.db' \) \
    -type f -print 2>/dev/null | sort -u
)

for db in "${dbs[@]}"; do
  node --import tsx -e "
    import { DatabaseSync } from 'doltlite';
    const dbPath = process.argv[1];
    const db = new DatabaseSync(dbPath);
    const tables = new Set(db.prepare(
      \"SELECT name FROM sqlite_schema WHERE type = char(116,97,98,108,101)\"
    ).all().map((row) => row.name));
    if (!tables.has('issues') || !tables.has('labels')) {
      console.log(JSON.stringify({ dbPath, skipped: 'missing issues/labels tables' }));
      db.close();
      process.exit(0);
    }
    const issueColumns = new Set(db.prepare('PRAGMA table_info(issues)').all().map((row) => row.name));
    if (!issueColumns.has('id') || !issueColumns.has('issue_type')) {
      console.log(JSON.stringify({ dbPath, skipped: 'missing Beads issue columns' }));
      db.close();
      process.exit(0);
    }
    db.exec('PRAGMA foreign_keys = ON');
    const before = {
      sessionIssues: db.prepare(\"SELECT count(*) AS c FROM issues WHERE issue_type = 'session'\").get().c,
      gcSessionLabels: db.prepare(\"SELECT count(*) AS c FROM labels WHERE label = 'gc:session'\").get().c,
    };
    db.exec(\"BEGIN;
      CREATE TEMP TABLE session_ids(id TEXT PRIMARY KEY);
      INSERT OR IGNORE INTO session_ids SELECT id FROM issues WHERE issue_type = 'session';
      INSERT OR IGNORE INTO session_ids SELECT issue_id FROM labels WHERE label = 'gc:session';
      DELETE FROM comments WHERE issue_id IN (SELECT id FROM session_ids);
      DELETE FROM compaction_snapshots WHERE issue_id IN (SELECT id FROM session_ids);
      DELETE FROM dependencies WHERE issue_id IN (SELECT id FROM session_ids) OR depends_on_id IN (SELECT id FROM session_ids);
      DELETE FROM events WHERE issue_id IN (SELECT id FROM session_ids);
      DELETE FROM interactions WHERE issue_id IN (SELECT id FROM session_ids);
      DELETE FROM issue_snapshots WHERE issue_id IN (SELECT id FROM session_ids);
      DELETE FROM labels WHERE issue_id IN (SELECT id FROM session_ids) OR label = 'gc:session';
      DELETE FROM wisp_comments WHERE issue_id IN (SELECT id FROM session_ids);
      DELETE FROM wisp_dependencies WHERE issue_id IN (SELECT id FROM session_ids) OR depends_on_id IN (SELECT id FROM session_ids);
      DELETE FROM wisp_events WHERE issue_id IN (SELECT id FROM session_ids);
      DELETE FROM wisp_labels WHERE issue_id IN (SELECT id FROM session_ids);
      DELETE FROM issues WHERE id IN (SELECT id FROM session_ids) OR issue_type = 'session';
      DROP TABLE session_ids;
      COMMIT;\");
    const after = {
      sessionIssues: db.prepare(\"SELECT count(*) AS c FROM issues WHERE issue_type = 'session'\").get().c,
      gcSessionLabels: db.prepare(\"SELECT count(*) AS c FROM labels WHERE label = 'gc:session'\").get().c,
    };
    console.log(JSON.stringify({ dbPath, before, after }));
    db.close();
  " "$db"
done
```

Expected result for each workspace DB that contains session beads:

```json
{"after":{"sessionIssues":0,"gcSessionLabels":0}}
```

## Optional: Full GC/Beads Workspace Rebuild

Use only when explicitly testing fresh Beads storage recreation. This deletes
workspace DBs for every packaged city.

```bash
for city in packages/gascity-config/config/cities/*; do
  [ -d "$city" ] || continue
  rm -rf \
    "$city/.beads/doltlite" \
    "$city/.beads/dolt" \
    "$city/.beads/embeddeddolt" \
    "$city/.beads/.br_history" \
    "$city/.beads/backups" \
    "$city/.beads/beads.db" \
    "$city/.beads/interactions.jsonl" \
    "$city/.beads/issues.jsonl" \
    "$city/.beads/routes.jsonl" \
    "$city/.beads/last-touched" \
    "$city/.beads/.local_version" \
    "$city/.beads/.write.lock" \
    "$city/.beads/.sync.lock" \
    "$city/.beads/bd.exec.lock"
done

rm -rf packages/gascity-config/config/cities/*/rigs/*/.beads
```

Do not delete `sample_beads_db_files`; those are fixture/repro data.

## Suspended-By-Default Config

For selective sidebar testing, packaged city config should cold-start with
workspaces, rigs, and explicit agent patches suspended:

```bash
rg -n 'suspended = false' \
  packages/gascity-config/config/cities/gastown \
  packages/gascity-config/config/cities/gascity-br \
  -g '*.toml'
```

Expected output: empty.

The sidebar should still render configured items while suspended, so users can
start exactly the city, rig, or agent under test.

## Restart

Before restarting, rerun the stop verification command above. Restart only when
the T3 app and GC controllers are stopped.

Restart from repo root:

```bash
cd /data/projects/t3code
bun dev
```

Runtime files should be recreated from source config.

## Verify Sidebar

Use the app and app APIs, not raw DB inspection.

Basic file recreation:

```bash
find /home/ubuntu/.t3 -maxdepth 3 \
  \( -name 'state.sqlite' -o -name 'state-proj.sqlite' \) \
  -print
```

GC process/runtime:

```bash
node scripts/gascity-runner.ts path
node scripts/gascity-runner.ts gc status
node scripts/gascity-runner.ts gc session list
```

Live sidebar QA with `agent-browser`:

- `Cities` folder renders even before sessions exist.
- Both configured cities render under `Cities`.
- Each city renders configured rigs.
- Each rig renders configured agents.
- Configured items remain visible while suspended.
- Controls are visible for city/workspace, rig, and agent start/stop/suspend.
- Starting one city does not start the other city.
- Starting one rig does not start every rig.
- GC-started threads appear under the matching `Cities -> City -> Rig -> Agent`
  branch.
- GC-started threads do not appear as duplicate native project folders.
- Provider session linkage is present in `/api/orchestration/snapshot` once an
  agent actually starts.

## If The Sidebar Is Wrong

- Duplicate native project folder: check stale thread metadata in the T3Code app
  DB or bridge stamping. Do not edit the DB with stock `sqlite3`.
- No `Cities` folder: check GC config discovery and generated runtime registry.
- City missing: check packaged city roots and `cities.toml` regeneration.
- Rig missing: check `[[rigs]]` in the city config.
- Agent missing: check pack expansion plus city-local `[[patches.agent]]`.
- Item starts unexpectedly: check `suspended = false`, `min_active_sessions`,
  and `[[named_session]] mode = "always"` in source config.

Fix repo code/config first, then restart so runtime is regenerated from source.
