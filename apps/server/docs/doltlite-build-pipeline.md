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

| Feature | Status | Upstream ref | Notes |
|---------|--------|-------------|-------|
| Hybrid ATTACH (btree files) | **Shipped** | README "ATTACH" section | `ATTACH DATABASE 'file.sqlite' AS ops` works for standard SQLite files |
| canDefer fix | **Shipped** | `fix/ephemeral-defer` branches | `canDefer = (pCur->pgnoRoot > 1)` — defers for non-schema btrees only |
| FTS5 in prolly tree | **Works** | Compile with `-DSQLITE_ENABLE_FTS5` | Requires `--enable-all` at configure time |
| WAL mode | **Not supported** | doltlite-pragmas.md | `PRAGMA journal_mode = WAL` silently ignored, stays on `delete` |
| dolt_gc() | **Works** | README "Garbage Collection" | `SELECT dolt_gc()` compacts unreachable chunks |

## Workaround Status

| Workaround | Location | Status | Remove when |
|------------|----------|--------|-------------|
| `canDefer = 1` override in prolly_btree.c | doltlite/src/prolly_btree.c | **REMOVED** (2026-03-30) | Upstream fix shipped, no local mod needed |
| `wal: false` in Sqlite.ts | apps/server/src/persistence/Layers/Sqlite.ts | **Still needed** | doltlite supports WAL mode (#215) |
| REINDEX after dolt_commit | ProjectionPipeline.ts | **Verify if still needed** | Upstream index corruption fix confirmed |
| REINDEX at startup | Sqlite.ts | **Verify if still needed** | Same as above |
| FTS btree sidecar ATTACH | Sqlite.ts, test | **Working** | Hybrid ATTACH shipped; could move FTS5 into main db if prolly-tree handles it |
| `Effect.catch(() => Effect.void)` | ProjectionPipeline.ts | **Should log, not swallow** | Change to `Effect.catchAll(logWarning)` |
| dolt_commit on every message | ProjectionPipeline.ts | **Should batch** | Batch commits more aggressively |
| dolt_gc on turn-start only | ProjectionPipeline.ts | **Review** | May not be needed with WAL; arbitrary trigger point |

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

## Common Failures

| Error | Cause | Fix |
|-------|-------|-----|
| `no such module: fts5` | Built without `--enable-all` | Re-run `../configure --enable-all && make doltlite-lib` |
| `orphan index` on CREATE TABLE | `canDefer = 1` override (defers schema btree writes) | Use upstream's `canDefer = (pCur->pgnoRoot > 1)` |
| `unable to open database` on ATTACH | Old doltlite without hybrid ATTACH | Pull latest upstream |
| `malformed database schema` | Stale .o files after upstream pull | `rm *.o && make doltlite-lib` |
| Addon not found (bindings error) | patch-doltlite not run after bun install | Run `node scripts/patch-doltlite.mjs` |

## Changelog

- **2026-03-30**: Created. Removed canDefer=1 local override. Confirmed FTS5 + hybrid ATTACH work with upstream. Tests pass on clean upstream master.
