Title: Per-session branch checkout corrupts original connection on subsequent read

Summary

Doltlite's README says branching is per session / per connection, and that two
connections can be on different branches at the same time. In practice, a
minimal two-connection repro appears to corrupt the original connection after a
branch is created and checked out on the second connection.

Observed error:

`SqliteError: database disk image is malformed`

Expected behavior:

- connection A stays on `main`
- connection B can create and check out `feature-branch`
- both connections can read the same table without corruption

Environment

- Doltlite repo: `/data/projects/doltlite`
- Repro discovered on 2026-03-31
- Database: temporary file-backed DB
- WAL enabled
- Client library: `better-sqlite3`

README behavior being exercised

From `README.md`:

- branching is "Per-Session"
- each connection tracks its own active branch
- two connections can be on different branches at the same time

Minimal repro

1. Open connection A to a fresh DB file
2. Create one table and one row
3. `SELECT dolt_commit('-A', '-m', 'init branch repro')`
4. Confirm connection A reports `active_branch() = 'main'`
5. Open connection B to the same DB file
6. On connection B:
   - `SELECT dolt_branch('feature-branch')`
   - `SELECT dolt_checkout('feature-branch')`
   - `SELECT active_branch()`
7. On connection A:
   - `SELECT active_branch()`
   - `SELECT * FROM threads ORDER BY thread_id`

Actual result

- connection B reports `active_branch() = 'feature-branch'`
- connection A still reports `active_branch() = 'main'`
- connection B can read `threads`
- connection A then fails on a simple read with:
  - `SqliteError: database disk image is malformed`
  - `SQLITE_CORRUPT`

This reproduces before any writes are made on the feature branch. The second
connection only creates and checks out the branch.

Repro script

Repo-local script:

- [apps/server/scripts/repro-doltlite-branch-per-session-corruption.mjs](/data/projects/t3code/apps/server/scripts/repro-doltlite-branch-per-session-corruption.mjs)

Exact script output from the failing run

```text
OK create schema
OK initial dolt commit on main
OK main active branch before second connection
[
  {
    "active_branch": "main"
  }
]
OK create branch on second connection
OK checkout branch on second connection
OK branch connection active branch
[
  {
    "active_branch": "feature-branch"
  }
]
OK main connection active branch stays main
[
  {
    "active_branch": "main"
  }
]
OK read rows on branch connection
[
  {
    "thread_id": "thread-main",
    "title": "Parent"
  }
]
FAIL read rows on original main connection
SqliteError: database disk image is malformed
```

Suggested investigation area

Likely around per-connection branch state and catalog / table-registry reload
interaction across multiple live connections:

- `src/doltlite_branch.c`
- branch checkout registry reload behavior mentioned in `README.md`
- any shared-state invalidation between `Btree` session branch pointers and
  shared chunk-store / schema state
