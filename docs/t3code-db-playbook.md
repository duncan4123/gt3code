# T3Code Database Playbook

This playbook is the required path for inspecting or repairing T3Code runtime
databases. Do not bypass it with raw database tools.

## First Rule

Do not run `sqlite3` against T3Code runtime databases.

T3Code's persistence layer opens the main state database through
`apps/server/src/persistence/NodeSqliteClient.ts`, which imports `DatabaseSync`
from `doltlite`. Treat the database format and connection behavior as
application-owned. A stock SQLite error such as `database disk image is
malformed` is not enough evidence that the DB is corrupt; it usually means the
wrong client or wrong file boundary was used.

## Runtime Files

T3Code derives its state path from `T3CODE_HOME`:

```text
${T3CODE_HOME:-~/.t3}/dev/state.sqlite       # dev main DB
${T3CODE_HOME:-~/.t3}/dev/state-proj.sqlite  # dev attached projection/event sidecar
${T3CODE_HOME:-~/.t3}/userdata/state.sqlite  # packaged/userdata main DB
${T3CODE_HOME:-~/.t3}/userdata/state-proj.sqlite
```

The main DB is opened with the Doltlite-backed app client. The sidecar is
created for high-write app tables and is still app-owned. Do not mutate either
file directly unless there is a purpose-built repair command/script that uses
the app persistence layer or the Doltlite client intentionally.

Gas City and Beads databases are separate. Examples:

```text
packages/gascity-config/config/.beads/doltlite/hq.db
/data/projects/beads-doltlite/.beads/doltlite/bd.db
```

Use the backend configured for that city/rig. A Doltlite-backed Beads DB must
be inspected with `bd` or the Doltlite client, not stock `sqlite3`.

## Inspection Order

1. Prefer app APIs and runtime state.
   - Sidebar data: `/api/orchestration/snapshot`
   - GC runtime: `bun gc ...` or `node scripts/gascity-runner.ts ...`
   - Live browser state: use `agent-browser` and authenticated `fetch` from
     the page context.
2. If a DB-level read of T3Code state is necessary, use Node from
   `apps/server` and the same `doltlite` package the server imports:

```bash
cd apps/server
node --import tsx -e "import { DatabaseSync } from 'doltlite';
const db = new DatabaseSync('/home/ubuntu/.t3/dev/state.sqlite', { readOnly: true });
console.log(db.prepare('SELECT doltlite_engine() AS engine').get());
db.close();"
```

Use `state.sqlite` for the Doltlite main DB and `state-proj.sqlite` for the
attached projection/event sidecar. Open both with `readOnly: true` for
inspection. Do not use Bun for this path; Bun cannot load `better-sqlite3`,
which backs the local `doltlite` package.

3. If a DB-level read of a Gas City or Beads Doltlite DB is necessary, use the
   dedicated Doltlite client or the domain CLI:

```bash
node packages/doltlite-client/scripts/dlite.mjs info <db-path> --json
node packages/doltlite-client/scripts/dlite.mjs tables <db-path> --json
node packages/doltlite-client/scripts/dlite.mjs query <db-path> 'SELECT ...' --json
```

4. For app-owned T3 state, prefer a small script that imports the server
   persistence services over ad hoc SQL. Keep reads narrow and print summaries,
   not table dumps.

Do not use `curl`, `wget`, inline HTTP, or broad raw DB dumps. Use the repo's
context-mode routing rules or browser-context fetches when inspecting APIs.

## Updating Thread Metadata

Thread metadata should be updated automatically through orchestration commands,
not by editing projection rows.

The canonical path is:

```text
thread.create / thread.meta.update command
  -> apps/server/src/orchestration/decider.ts
  -> buildStampedGcMetadataUpdate(...)
  -> thread.created / thread.meta-updated event
  -> projector/projection pipeline
  -> sidebar snapshot
```

If metadata is stale, fix one of these application boundaries:

- ingestion stamping in `apps/server/src/gc/folderMetadata.ts`
- command deciding in `apps/server/src/orchestration/decider.ts`
- projection/read repair in `apps/server/src/orchestration/Layers/*`
- sidebar grouping normalization in `packages/contracts/src/gc.ts`

Read-side normalization may repair display for old rows, but it does not rewrite
stored metadata. If the stored metadata must change, add an app-owned repair
command or migration that emits/handles `thread.meta.update` semantics.

## Repair Safety Checklist

Before any destructive or mutating operation:

1. Confirm the process owner and runtime home.
2. Stop the T3 server/supervisor that owns the files.
3. Back up the whole state directory, not only one DB file.
4. Identify whether the target is T3 state, GC runtime state, or Beads data.
5. Use the app client, `dlite`, `bd`, or `gc` as appropriate.
6. Restart the app and verify through `/api/orchestration/snapshot` and the UI.

Never infer provider-session binding, GC city identity, or sidebar grouping from
raw rows alone. Use the app snapshot plus runtime metadata as the source of
truth.
