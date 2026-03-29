# Doltlite Database Health

## Quick Reference

```bash
# Diagnose (read-only, safe to run anytime)
node scripts/doltlite-rebuild.ts

# Rebuild (backup + export + reimport)
node scripts/doltlite-rebuild.ts --rebuild

# Custom path
node scripts/doltlite-rebuild.ts --path ~/.t3/userdata/state.sqlite
```

## Background

t3code stores all orchestration events, thread projections, and session state in a doltlite database (`~/.t3/dev/state.sqlite` in dev mode). Doltlite replaces SQLite's B-tree storage with a prolly-tree engine that supports git-like versioning (`dolt_commit`, `dolt_log`, `dolt_branch`, etc.).

The file format is a single file containing:
- Manifest header (168 bytes)
- Compacted chunks + index
- WAL region (appended at EOF)

Each `dolt_commit` creates new chunks. `dolt_gc()` compacts unreachable chunks.

## Known Issues

### Index corruption (prolly-tree desync)

**Symptom:** `PRAGMA integrity_check` reports rows missing from indexes.

**Cause:** Doltlite's prolly-tree can desync indexes from table data during commit flushes. This is an upstream bug. The multi-row DELETE fix (doltlite `3dcc1355c`) addressed one cause, but corruption has been observed on builds that include the fix.

**Fix:** `REINDEX;` rebuilds all indexes from table data. This works on the prolly tree — the rebuilt indexes get new chunks in the working set.

**Prevention:** t3code runs `REINDEX` at startup (in `Sqlite.ts` after migrations) and after each `dolt_commit` (in `ProjectionPipeline.ts`). These are marked as workarounds to remove once the upstream bug is fixed.

### GC sweep failure

**Symptom:** `SELECT dolt_gc()` returns "gc sweep phase failed".

**Cause:** The GC sweep phase reads every surviving chunk's bytes to build a compacted file. If any chunk is corrupted or at a wrong offset, the read fails. Index corruption can leave orphaned chunk references that trigger this.

**Effect:** The database file grows indefinitely (every `dolt_commit` adds chunks that can never be collected). A few hours of dev usage can produce a 1GB+ file for only a few thousand rows.

**Fix:** Rebuild the database with `doltlite-rebuild.ts --rebuild`. This exports all live data, creates a fresh database with a clean chunk store, and reimports. Dolt history is lost but GC works again.

### Silent error swallowing (fixed)

The `dolt_commit` cycle in `ProjectionPipeline.ts` previously used `Effect.catch(() => Effect.void)`, silently swallowing all dolt operation failures including GC errors. This has been changed to `Effect.catchAll((e) => Effect.logWarning(...))` so failures are visible in server logs.

## Diagnosis Checklist

| Check | Command | Healthy |
|-------|---------|---------|
| SQLite integrity | `PRAGMA integrity_check` | Returns `ok` |
| Engine type | `SELECT doltlite_engine()` | Returns `prolly` |
| GC works | `SELECT dolt_gc()` | Returns `N chunks removed, M chunks kept` |
| File size | `ls -lh state.sqlite` | Proportional to data, not commit count |

Run `node scripts/doltlite-rebuild.ts` to check all of these automatically.

## Rebuild Process

`doltlite-rebuild.ts --rebuild` performs:

1. Backs up current database to `state.sqlite.<timestamp>.bak`
2. Reads all rows from all tables into memory
3. Deletes the corrupted database file
4. Creates a fresh doltlite database with a clean chunk store
5. Replays the schema (tables + indexes from backup)
6. Seeds a fresh FTS btree sidecar (`state-fts.sqlite`)
7. Reimports all rows
8. Runs `dolt_add('-A')` + `dolt_commit` for a single clean commit
9. Verifies integrity, GC, and row count match

**What you keep:** All table data (threads, messages, events, sessions).
**What you lose:** Dolt commit history (the 588 commits become 1).

## Runtime Defenses

Two layers of REINDEX protection are in place:

1. **Startup** (`Sqlite.ts`): Runs `REINDEX` after migrations complete — heals any corruption from the previous session before the app starts serving.

2. **Runtime** (`ProjectionPipeline.ts`): Runs `REINDEX` after each `dolt_commit` — prevents corruption from accumulating during a session. Cheap on a healthy database since the actual row count is small even if the file is large.

Both are wrapped in error handling and won't crash the app if they fail.
