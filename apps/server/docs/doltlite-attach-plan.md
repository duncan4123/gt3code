# Plan: Hybrid ATTACH — Standard SQLite B-tree Files in Doltlite

## Goal

Allow `ATTACH DATABASE 'file.db' AS name` to open standard SQLite (B-tree) files from a doltlite connection, enabling hybrid storage: prolly-trees for versionable tables, B-trees for high-write operational tables, same connection, cross-database JOINs.

## Why

Doltlite's prolly-tree indexes degrade under heavy sequential writes (event sourcing). Standard SQLite B-trees handle this fine. Users need both: versioning for some tables, reliability for others. Currently ATTACH only creates doltlite files — attaching a standard SQLite file fails with "unable to open database."

## Approach

### Phase 1: File format detection

In `src/attach.c`, when opening an attached database:

1. Read the first 16 bytes of the file
2. If header matches `"SQLite format 3\000"` → standard SQLite B-tree file
3. Otherwise → doltlite prolly-tree file (existing behavior)
4. New files (doesn't exist yet) → default to prolly-tree (existing behavior)

### Phase 2: Route to correct pager

The B-tree pager code is already in `src/btree.c` (395KB). Doltlite replaced the default storage path with prolly-trees but the original code is still compiled in.

For attached B-tree files:
- Route `sqlite3BtreeOpen()` to the **original** SQLite B-tree implementation
- The B-tree pager handles its own page cache, journal, and locking
- No prolly-tree involvement for reads or writes to these tables

For attached prolly-tree files:
- Existing behavior, no changes

### Phase 3: Cross-database operations

Cross-database JOINs already work with ATTACH (tested). The query planner treats attached databases as separate schemas. The change is only in which storage engine backs each attached file.

Verify:
- `SELECT` across B-tree and prolly-tree tables
- `INSERT/UPDATE/DELETE` into attached B-tree tables
- Transactions spanning both storage engines
- `ATTACH` / `DETACH` lifecycle

### Phase 4: New file creation flag

Allow users to create a new attached database as standard SQLite:

```sql
-- Prolly-tree (default, existing behavior)
ATTACH DATABASE 'versioned.db' AS v;

-- Standard SQLite B-tree (new)
ATTACH DATABASE 'file:events.db?btree=1' AS ops;
```

Use SQLite's URI filename convention to pass the storage engine flag.

## Out of scope

- Doltlite version control commands (`dolt_commit`, `dolt_diff`) on attached B-tree tables — these only work on prolly-tree tables
- WAL mode for the main doltlite database — separate issue
- Reverse direction (standard SQLite attaching doltlite files)

## Files to modify

- `src/attach.c` — file header detection and pager routing
- `src/btree.c` / `src/btree.h` — may need to expose original B-tree open path if it's been made static
- `src/pager.c` — if pager selection happens here instead of attach.c
- Build system — ensure B-tree code paths aren't dead-code eliminated

## Testing

1. Attach standard SQLite file created by `sqlite3` CLI → read and write
2. Attach doltlite file → existing behavior preserved
3. Cross-database JOIN between B-tree and prolly-tree tables
4. Transaction rollback spanning both engines
5. DETACH and re-ATTACH
6. `integrity_check` on both attached databases
7. URI flag for creating new B-tree attached databases

## Related

- timsehn/doltlite#180 — MAX() bug in prolly-tree indexes
- timsehn/doltlite#181 — Feature request for this work
