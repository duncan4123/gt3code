# Doltlite Build Pipeline

> Single source of truth for building doltlite and integrating it with t3code.
> Keep this doc updated when upstream changes or workarounds are added/removed.

## Quick Reference

```bash
# 1. Build doltlite
cd /data/projects/doltlite/build
../configure --enable-all    # --enable-all required for FTS5
make doltlite-lib            # produces libdoltlite.a + libdoltlite.so

# 2. Patch better-sqlite3 addon
cd /data/projects/t3code/apps/server
node scripts/patch-doltlite.mjs

# 3. Verify
npx vitest run src/persistence/Layers/DoltliteProduction.test.ts
```

## Build Steps (Detailed)

### 1. Pull upstream doltlite

```bash
cd /data/projects/doltlite
git checkout master          # master tracks upstream, keep it clean
git pull upstream master
```

**Do NOT modify files on master.** If you need local patches, create a branch.
Master must stay clean for rebasing from upstream.

### 2. Configure

```bash
cd build
../configure --enable-all
```

`--enable-all` enables: FTS4, **FTS5**, RTREE, GEOPOLY, SESSION, CARRAY, and more.
Without it, FTS5 is not compiled and `CREATE VIRTUAL TABLE ... USING fts5(...)` fails.

The doltlite README shows `../configure` without flags, but the
[compile-for-unix.md](../../../doltlite/doc/compile-for-unix.md) doc specifies
`--enable-all`. **Always use `--enable-all` for t3code builds.**

### 3. Build library

```bash
make doltlite-lib
```

This produces:

- `libdoltlite.a` (static library, ~2.5 MB)
- `libdoltlite.so` / `libdoltlite.dylib` (shared library)
- `sqlite3.h` (header, needed by node-gyp)

### 4. Patch better-sqlite3

```bash
cd /data/projects/t3code/apps/server
node scripts/patch-doltlite.mjs
```

This script (on `doctor-dolittle` branch):

1. Finds better-sqlite3 in bun's module cache
2. Replaces `deps/sqlite3.gyp` to link against `libdoltlite.a`
3. Runs `node-gyp rebuild` to produce a new `better_sqlite3.node`
4. Skips rebuild if the existing addon already links doltlite and is newer than the lib
5. Records the doltlite git hash in `.doltlite-version`

**Env override:** `DOLTLITE_BUILD_DIR=/path/to/build` (default: `/data/projects/doltlite/build`)

### 5. Test

```bash
npx vitest run src/persistence/Layers/DoltliteProduction.test.ts
```

Two tests:

- `survives 10 threads with 50 turns each` (heavy session)
- `survives 50 threads with 20 turns each` (many-thread session)

Both create a doltlite db, ATTACH a btree FTS sidecar, simulate production
write patterns with dolt_commit + dolt_gc cycles, and verify data integrity.

## Upstream Feature Status

| Feature                     | Status            | Upstream ref                        | Notes                                                                  |
| --------------------------- | ----------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| Hybrid ATTACH (btree files) | **Shipped**       | README "ATTACH" section             | `ATTACH DATABASE 'file.sqlite' AS ops` works for standard SQLite files |
| canDefer fix                | **Shipped**       | `fix/ephemeral-defer` branches      | `canDefer = (pCur->pgnoRoot > 1)` — defers for non-schema btrees only  |
| FTS5 in prolly tree         | **Works**         | Compile with `-DSQLITE_ENABLE_FTS5` | Requires `--enable-all` at configure time                              |
| WAL mode                    | **Not supported** | doltlite-pragmas.md                 | `PRAGMA journal_mode = WAL` silently ignored, stays on `delete`        |
| dolt_gc()                   | **Works**         | README "Garbage Collection"         | `SELECT dolt_gc()` compacts unreachable chunks                         |

## Workaround Status

| Workaround                                | Location                                     | Status                    | Remove when                                                                   |
| ----------------------------------------- | -------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `canDefer = 1` override in prolly_btree.c | doltlite/src/prolly_btree.c                  | **REMOVED** (2026-03-30)  | Upstream fix shipped, no local mod needed                                     |
| `wal: false` in Sqlite.ts                 | apps/server/src/persistence/Layers/Sqlite.ts | **Still needed**          | doltlite supports WAL mode (#215)                                             |
| REINDEX after dolt_commit                 | ProjectionPipeline.ts                        | **REMOVED** (2026-03-30)  | Upstream index corruption fix confirmed                                       |
| REINDEX at startup                        | Sqlite.ts                                    | **REMOVED** (2026-03-30)  | Same as above                                                                 |
| FTS btree sidecar ATTACH                  | Sqlite.ts, test                              | **Working**               | Hybrid ATTACH shipped; could move FTS5 into main db if prolly-tree handles it |
| FTS ops best-effort `catchAll`            | ProjectionPipeline.ts                        | **Fixed** (2026-03-30)    | FTS failures log warnings, never block pipeline                               |
| `SqlError` catchTag on `projectEvent`     | ProjectionPipeline.ts                        | **Restored** (2026-03-30) | Required to wrap raw SqlErrors for proper error propagation                   |
| dolt_commit on every message              | ProjectionPipeline.ts                        | **Should batch**          | Batch commits more aggressively                                               |
| dolt_gc on turn-start only                | ProjectionPipeline.ts                        | **Review**                | May not be needed with WAL; arbitrary trigger point                           |

## Key Files

### doltlite repo (`/data/projects/doltlite`)

- `README.md` — upstream docs, ATTACH examples, build instructions
- `doc/compile-for-unix.md` — `--enable-all` flag documented here
- `build/` — build output directory (libdoltlite.a, sqlite3.h)
- `src/prolly_btree.c` — canDefer logic (lines ~3347, ~3694)

### t3code repo (`/data/projects/t3code`)

- `apps/server/scripts/patch-doltlite.mjs` — patches better-sqlite3 to use doltlite
- `apps/server/src/persistence/Layers/Sqlite.ts` — db open, ATTACH fts sidecar, wal flag
- `apps/server/src/persistence/Layers/DoltliteProduction.test.ts` — integration tests
- `apps/server/src/persistence/DoltliteClient.ts` — PRAGMA application
- `apps/server/docs/doltlite-health.md` — diagnosis and rebuild guide
- `apps/server/docs/doltlite-pragmas.md` — PRAGMA compatibility (**needs update: ATTACH now works**)
- `apps/server/docs/doltlite-attach-plan.md` — **STALE: hybrid ATTACH already shipped upstream**
- `scripts/doltlite-rebuild.ts` — database rebuild tool for corrupted databases

## Known Integration Issues

### FTS operations must be non-fatal in ProjectionPipeline

**Problem:** The FTS5 sidecar operations (`upsertMessageFtsDocument`, `deleteMessageFtsDocuments`,
`rebuildThreadFtsDocuments`) run inside the message projector's `apply()` function. If any FTS
operation fails (sidecar corruption, missing ATTACH, btree I/O error), the error propagates through:

```
projector.apply() → runProjectorForEvent() → projectEvent() → processEnvelope()
```

This kills the entire command dispatch chain. The `ProviderRuntimeIngestion.processInputSafely`
catches the error and logs a warning, but the remaining dispatches for that runtime event
(e.g., `thread.session.set` with `status: "ready"`) **never execute**. The session stays stuck
in `"running"` state and the web client shows "working" indefinitely.

**Fix:** All FTS operations in ProjectionPipeline are wrapped in `Effect.catchAll` to make them
best-effort. FTS failures log warnings but never block the projection pipeline. The main
message data (in `projection_thread_messages`) is always written regardless of FTS state.

**Key insight:** `getSnapshot()` reads from the **database projections**, not the in-memory
read model. The in-memory model is reconciled after dispatch failures, but database projections
stay stale — so the web client sees stale session state.

### SqlError catchTag must remain on projectEvent

**Problem:** Upstream's `projectEvent` has `Effect.catchTag("SqlError", ...)` to wrap raw SQL
errors from projector operations. We removed this during the doltlite integration because we
removed `sql.withTransaction` (which was the primary SqlError source). But individual projector
SQL operations can still throw raw `SqlError` — these must be caught and wrapped in
`PersistenceSqlError` for proper error propagation through the OrchestrationEngine.

**Fix:** Restored `SqlError` catchTag on `projectEvent`.

### dolt_commit strategy and event pipeline interaction

The dolt_commit logic in `projectEvent` runs **after** all projectors have finished for a given
event. It only commits on structural events (`project.created`, `thread.created`,
`thread.turn-diff-completed`, etc.) — high-frequency events (`thread.message-sent`,
`thread.activity-updated`) skip the commit and let data accumulate in the working set.

The dolt_commit block is wrapped in `Effect.catch` so commit failures never block the pipeline.
However, 15 sequential synchronous SQL calls (12 `dolt_add` + `dolt_commit` + `dolt_tag`)
through the `Semaphore(1)` in DoltliteClient can cause latency spikes. This is acceptable
because the command queue serializes processing anyway.

### Missing upstream fixes to cherry-pick

After the merge base (`23b3f0c3`), upstream added several fixes that affect doltlite integration:

| Commit     | PR    | Impact                                                | Cherry-picked?                            |
| ---------- | ----- | ----------------------------------------------------- | ----------------------------------------- |
| `9e605971` | #1499 | Truncate oversized git diffs instead of failing       | **Yes** (2026-03-30)                      |
| `a1c428b6` | #1512 | Refactor projection pipeline side effects (Effect.fn) | No — large refactor, merge carefully      |
| `3e2df5a7` | #1475 | Normalize typed provider runtime ingestion            | No — cleanup only, old helpers still work |
| `5513845f` | #1375 | Auto-generate first-turn thread titles                | No — new feature                          |
| `33773ff1` | #1504 | Harden Claude stream exit handling                    | No — Claude-specific                      |
| `792ad4b5` | #1538 | Fix model settings getting stuck                      | No — settings fix                         |

## Common Failures

| Error                                    | Cause                                                                    | Fix                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `no such module: fts5`                   | Built without `--enable-all`                                             | Re-run `../configure --enable-all && make doltlite-lib`               |
| `orphan index` on CREATE TABLE           | `canDefer = 1` override (defers schema btree writes)                     | Use upstream's `canDefer = (pCur->pgnoRoot > 1)`                      |
| `unable to open database` on ATTACH      | Old doltlite without hybrid ATTACH                                       | Pull latest upstream                                                  |
| `malformed database schema`              | Stale .o files after upstream pull                                       | `rm *.o && make doltlite-lib`                                         |
| Addon not found (bindings error)         | patch-doltlite not run after bun install                                 | Run `node scripts/patch-doltlite.mjs`                                 |
| Chat hangs on "working" after first turn | FTS sidecar failure kills projection pipeline, session stays `"running"` | Ensure FTS ops are best-effort (catchAll); check btree sidecar exists |
| Diffs panel shows nothing                | Oversized diffs fail without truncation                                  | Cherry-pick `9e605971` (truncate oversized diffs)                     |
| `database disk image is malformed`       | Doltlite prolly-tree corruption                                          | Run `scripts/doltlite-rebuild.ts`; check dolt_commit frequency        |

## Changelog

- **2026-03-30**: Fixed cascade failure — FTS operations made best-effort, SqlError catchTag restored on projectEvent, cherry-picked oversized diff truncation (#1499). Documented known integration issues and upstream cherry-pick status.
- **2026-03-30**: Created. Removed canDefer=1 local override. Confirmed FTS5 + hybrid ATTACH work with upstream. Tests pass on clean upstream master.
