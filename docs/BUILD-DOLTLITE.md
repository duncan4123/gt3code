# Building context-mode-doltlite

This document covers the full pipeline from building the doltlite C library to
running context-mode with a doltlite-backed knowledge base.

## Prerequisites

- Node.js v22+ with node-gyp
- GCC/Clang toolchain (for native addon rebuild)
- zlib (`-lz`) and pthread (`-lpthread`) — standard on Linux/macOS
- The [doltlite](https://github.com/sfncore/doltlite) repo cloned alongside this one

Expected directory layout:

```
/data/projects/
  doltlite/           # doltlite C library
  claude-context-mode/ # this repo (context-mode-doltlite)
```

## Step 1: Build doltlite

```bash
cd /data/projects/doltlite/build
../configure
make doltlite-lib
```

This produces:
- `build/libdoltlite.a` — static library (2.6 MB)
- `build/sqlite3.h` — doltlite's SQLite-compatible header

Verify the build:

```bash
./doltlite :memory: "SELECT doltlite_engine();"
# prolly
```

## Step 2: Patch better-sqlite3

The patch script rewrites better-sqlite3's GYP build config to link against
`libdoltlite.a` instead of the bundled SQLite amalgamation, then rebuilds.

```bash
cd /data/projects/claude-context-mode
node scripts/patch-doltlite.mjs
```

The script:
1. Locates `libdoltlite.a` at `$DOLTLITE_BUILD_DIR` (default: `/data/projects/doltlite/build`)
2. Finds better-sqlite3 in `node_modules/`, marketplace plugin dirs, or plugin cache
3. Rewrites `deps/sqlite3.gyp` to link against the prebuilt static library
4. Runs `node-gyp rebuild`
5. Verifies `SELECT doltlite_engine()` returns `prolly`
6. Skips rebuild if already patched (idempotent)

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOLTLITE_BUILD_DIR` | `/data/projects/doltlite/build` | Path to doltlite build output |

### What changes

The only file modified in better-sqlite3 is `deps/sqlite3.gyp` (overwritten in
place — no backup is created). The native addon (`better_sqlite3.node`)
grows from ~2 MB to ~6 MB because it now includes the prolly tree engine.

## Step 3: Install and run

```bash
npm install          # postinstall auto-runs patch-doltlite.mjs
npm run build        # TypeScript compile
node start.mjs       # start MCP server
```

The `postinstall` hook calls `patch-doltlite.mjs` automatically. If
`libdoltlite.a` is not found, it skips silently — standard SQLite works fine.

## Step 4: Verify

### Via doctor

```bash
node build/cli.js doctor
```

Expected output includes:
```
FTS5 / SQLite: PASS — native module works
Doltlite: PASS — engine: prolly
```

### Via MCP tools

After starting the MCP server:
```
ctx_status
```

Should report `Engine: prolly` instead of `Engine: sqlite`.

## How it works

### Architecture

```
context-mode-doltlite
  └── better-sqlite3 (native addon)
        └── links against libdoltlite.a (instead of sqlite3.c)
              └── prolly tree engine (content-addressed, git-like versioning)
                    └── CTLD-format database files
```

### Database format

Doltlite databases use a `CTLD` file header (not `SQLite format 3`). Standard
SQLite tools cannot open them. The doltlite-patched better-sqlite3 reads and
writes both formats transparently.

### WAL compatibility

Since doltlite#118 (Manifest V6, single-file storage), the WAL is merged into
the main database file as an append-only region at EOF — there are no separate
`-wal` or `-shm` sidecar files. SQLite's `journal_mode = WAL` pragma is
incompatible with this internal WAL.

`db-base.ts` handles this in three places:

1. **`applyWALPragmas()`** — detects doltlite via `SELECT doltlite_engine()`
   and skips `journal_mode = WAL` + `synchronous = NORMAL`.
2. **`closeDB()`** — skips `wal_checkpoint(TRUNCATE)` under doltlite since
   the internal WAL is managed by the prolly chunk store.
3. **`deleteDBFiles()`** — still attempts `-wal`/`-shm` cleanup (harmless
   no-ops under doltlite's single-file format).

#### Lessons from t3code migration

The t3code project completed the same SQLite→doltlite migration (Mar 26, 2026).
Key compatibility findings that also apply here:

- **AUTOINCREMENT**: Supported in current doltlite builds (was rejected in
  earlier versions — monitor if upgrading doltlite).
- **JSON SQL functions**: `json_set`, `json_type` etc. may be unavailable.
  context-mode does not use these currently.
- **FTS5**: Supported and verified working with doltlite-patched better-sqlite3.

### Version control via SQL

Once doltlite is active, the knowledge base supports git-like operations:

```sql
SELECT dolt_commit('-A', '-m', 'indexed React docs');
SELECT * FROM dolt_log;
SELECT * FROM dolt_diff('chunks');
SELECT dolt_branch('experiment');
SELECT dolt_checkout('experiment');
SELECT dolt_merge('main');
```

These are exposed through the `ctx_commit`, `ctx_log`, `ctx_diff`, and
`ctx_status` MCP tools.

## Updating doltlite

When the doltlite library is rebuilt (e.g., after pulling upstream changes):

```bash
cd /data/projects/doltlite/build
make clean && make doltlite-lib

cd /data/projects/claude-context-mode
# Force rebuild by removing the cached check
rm node_modules/better-sqlite3/build/Release/better_sqlite3.node
node scripts/patch-doltlite.mjs
```

## Troubleshooting

### "file is not a database"

The database has a `CTLD` header (doltlite format) but better-sqlite3 is not
patched. Run `node scripts/patch-doltlite.mjs` and restart.

### "libdoltlite.a not found"

Set `DOLTLITE_BUILD_DIR` to the directory containing `libdoltlite.a` and
`sqlite3.h`, or build doltlite first (Step 1).

### Doctor shows "Doltlite: not patched"

Run `node scripts/patch-doltlite.mjs` to patch better-sqlite3, then restart
the MCP server.

### ABI mismatch after Node.js upgrade

Delete the cached binary and re-patch:

```bash
rm node_modules/better-sqlite3/build/Release/better_sqlite3.node
node scripts/patch-doltlite.mjs
```
