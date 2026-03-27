# Doltlite PRAGMA Compatibility

## Known Issues

### journal_mode = WAL — DO NOT USE

Doltlite **silently ignores** `PRAGMA journal_mode = WAL`. It remains on `delete` (rollback journal) regardless. However, our DoltliteClient pairs WAL with `synchronous = NORMAL`, which **does take effect**. Running rollback journal with `synchronous = NORMAL` is unsafe and causes database corruption under normal write load.

**Current setting:** `wal: false` in `Sqlite.ts` — this prevents both pragmas from being applied.

**Evidence:** Fresh databases corrupted within minutes of normal use ("database disk image is malformed") when `wal: false` was removed. Reverting to `wal: false` appears to fix the corruption.

## Questions for doltlite developer

### 1. Which journal modes are supported?
- `PRAGMA journal_mode = WAL` is silently ignored (returns `delete`)
- Is `delete` the only supported mode?
- Are `truncate`, `persist`, or `memory` supported?

### 2. What synchronous settings are safe?
- We're using the default (`synchronous = FULL` when wal is off)
- Is `synchronous = NORMAL` safe with doltlite's prolly-tree storage?
- Does `synchronous` interact differently with prolly-trees vs B-trees?

### 3. Which PRAGMAs are supported at all?
- `foreign_keys = ON` — appears to work
- `journal_mode` — silently ignored for WAL
- `integrity_check` — runs but reports false positives ("rows missing from index" on freshly created indexes)
- `REINDEX` — runs but doesn't fix reported issues
- Is there a list of supported/unsupported PRAGMAs?

### 4. Secondary index behavior
- We see `MAX(col) WHERE ...` returning wrong results on indexed columns (filed as #180)
- `integrity_check` reports "rows missing from index" even on freshly created indexes with freshly inserted data
- `REINDEX` and `DROP INDEX` + `CREATE INDEX` don't resolve the integrity_check warnings
- Are these false positives from `integrity_check`, or real index corruption?
- Is there a known write volume threshold where secondary indexes become unreliable?

### 5. ATTACH DATABASE
- `ATTACH` works between two doltlite files with cross-database JOINs
- `ATTACH` of a standard SQLite (B-tree) file fails: "unable to open database"
- Feature request filed as #181 for hybrid B-tree/prolly-tree ATTACH support

## Related Issues

- timsehn/doltlite#180 — MAX() aggregate with WHERE clause returns wrong results
- timsehn/doltlite#181 — Feature: ATTACH standard SQLite B-tree databases

## Files

- `apps/server/src/persistence/DoltliteClient.ts` — PRAGMA application in `openDB()` (line 89-92)
- `apps/server/src/persistence/Layers/Sqlite.ts` — `wal: false` setting (line 10)
