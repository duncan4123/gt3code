# Context-Mode Doltlite Integration: Complete Breakdown

This document outlines all changes made to the context-mode repository to integrate doltlite as the primary database engine (replacing optional SQLite).

---

## Phase 1: Foundation Setup

### 1.1 Repository Rename & Architecture Decision
**Commit:** `63ec9d1` — "Rename fork to context-mode-doltlite"

- Renamed repository from `mksglu/context-mode` to `sfncore/claude-context-mode`
- Declared doltlite as the primary database engine (not optional)
- Established doltlite as a required dependency for all installations

### 1.2 Persistent Database Support
**Commit:** `42b4aa0` — "Persistent FTS5 knowledge bases across sessions"

**What changed:**
- Added support for multi-session knowledge base persistence
- Introduced ephemeral vs. persistent database distinction
- Enabled cross-session search via FTS5 indexing

**Key additions:**
- Session databases stored in `~/.context-mode/session-*.db`
- Persistent databases in `~/.context-mode/persistent/`
- Auto-cleanup of stale session files after 7 days

---

## Phase 2: Native Doltlite Patching

### 2.1 Core Patch Script
**Commit:** `0a6d717` — "feat: doltlite integration — patch script, WAL skip, and doctor check"

**Files added:** `scripts/patch-doltlite.mjs` (182 lines)

**What it does:**
1. **Locates doltlite build artifacts**
   - Searches for `libdoltlite.a` (static library, ~2.6 MB)
   - Finds `sqlite3.h` header from doltlite build
   - Respects `DOLTLITE_BUILD_DIR` env var (default: `/data/projects/doltlite/build`)

2. **Patches better-sqlite3 GYP config**
   - Modifies `node_modules/better-sqlite3/deps/sqlite3.gyp`
   - Replaces SQLite amalgamation with `libdoltlite.a` link
   - Adds doltlite header include paths

3. **Rebuilds native addon**
   - Runs `node-gyp rebuild` to compile patched binary
   - Native addon grows from ~2 MB to ~6 MB (includes prolly tree engine)
   - Verifies success: `SELECT doltlite_engine()` returns `"prolly"`

4. **Graceful fallback**
   - If `libdoltlite.a` not found, skips silently
   - Standard SQLite works fine (for CI, plain installs)

5. **Idempotent & postinstall hook**
   - Skips rebuild if already patched
   - Auto-runs via `npm postinstall`

### 2.2 WAL Pragma Handling
**File:** `src/db-base.ts`

**Changes:**
```typescript
// Skip WAL under doltlite — it manages its own journal (#131)
try {
  (db as any).prepare("SELECT doltlite_engine()").get();
  return; // doltlite active, skip WAL
} catch { /* standard SQLite — apply WAL below */ }
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
```

**Why:**
- Doltlite's prolly tree engine uses internal WAL (append-only region at EOF)
- No separate `-wal` / `-shm` sidecar files
- SQLite's `journal_mode = WAL` pragma is incompatible with doltlite's single-file storage
- Also skips `wal_checkpoint(TRUNCATE)` in `closeDB()` — doltlite manages chunking internally

### 2.3 Doctor Command Enhancement
**File:** `src/cli.ts`

**New diagnostics:**
- Validates `better-sqlite3` native module loads
- Tests direct SQL: `SELECT doltlite_engine()`
- Reports patch status: `PASS` (prolly engine) vs `FAIL` (not patched)
- Shows SQLite version vs doltlite version

---

## Phase 3: Database Engine Abstraction

### 3.1 Named Persistent Databases
**Commit:** `1c57525` — "Add database parameter to index/search/batch_execute tools"
**Commit:** `eedd03e` — "Named persistent databases — database param on index/search/batch_execute"

**What changed:**
- All major MCP tools now accept optional `database` parameter
- Tools affected:
  - `ctx_index(database?, content/path, source)`
  - `ctx_search(database?, queries, limit, ...)`
  - `ctx_batch_execute(database?, commands, queries)`
  - `ctx_fetch_and_index(database?, url, source)`

**Database resolution logic:**
```typescript
function resolveStore(nameOrUndefined?: string) {
  if (!nameOrUndefined) return getStore(); // ephemeral session DB
  return getPersistentStore(nameOrUndefined); // ~/.context-mode/persistent/{name}.db
}
```

**Benefits:**
- Multiple independent knowledge bases per project
- Project-specific persistent storage
- Session isolation without collision

### 3.2 Bead Schema Addition
**Commit:** `5796546` — "Add doltlite bead schema and draft convoy MCP tools"

**Schema additions:**
- `issues` table: tracks beads/convoys across sessions
- `beads` table: individual work items
- `convoys` table: parent issue groups
- `dependencies` table: blocking relationships

**Tools added:**
- `ctx_convoy_create()` — Create parent work group
- `ctx_bead_create()` — Create individual task
- `ctx_dep_add()` — Link dependencies
- `ctx_convoy_list()` — View work structure

---

## Phase 4: Version Control Features

### 4.1 Git-like Operations
**Commit:** `decdc5c` — "Add dolt version control tools for project docs"

**New MCP tools:**
- `ctx_commit(message)` — Create versioned snapshot
- `ctx_log(limit?)` — View commit history
- `ctx_diff(from_commit?, to_commit?, table?)` — Show changes
- `ctx_docs_branch(action: create|checkout|list|merge, name)` — Branch management

**SQL functions exposed:**
```sql
SELECT dolt_commit('-A', '-m', 'indexed React docs');
SELECT * FROM dolt_log;
SELECT * FROM dolt_diff('chunks');
SELECT dolt_branch('experiment');
SELECT dolt_checkout('experiment');
SELECT dolt_merge('main');
```

### 4.2 Project Docs Tables
**Commit:** `97628df` — "Add version-controlled project docs tables and MCP tools"

**New schema:**
- `docs_config` — Key/value project settings
- `docs_workarounds` — Active/removed/verify status tracker (temp fixes)
- `docs_plans` — Planned work items
- `docs_failures` — Common errors and fixes (troubleshooting)
- `docs_log` — Audit trail for all mutations (immutable)

**Tables auto-create** on session start via:
```sql
CREATE TABLE IF NOT EXISTS docs_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```

### 4.3 Project Docs MCP Tools
**File:** `src/server.ts` (199 new lines)

**Tools added:**

1. **`ctx_docs_status(database?)`**
   - Show active workarounds, plans, config, recent log
   - Read at session start to understand project state
   - Human-readable summary

2. **`ctx_docs_query(sql, database?)`**
   - Read-only SQL SELECT against docs_* tables
   - Ad-hoc queries for custom analysis

3. **`ctx_docs_update(sql, message, database?)`**
   - Mutate docs_* tables (INSERT/UPDATE/DELETE)
   - Logs operation with message to `docs_log`
   - Optional dolt_commit after mutation
   - Auto-recorded in audit trail

4. **`ctx_docs_commit(message, database?)`**
   - Explicit dolt_commit for docs changes
   - Creates version control snapshot

5. **`ctx_docs_log(limit?, database?)`**
   - Show commit history for docs
   - Falls back to `docs_log` table if dolt unavailable

6. **`ctx_docs_diff(from_commit?, to_commit?, table?, database?)`**
   - Show changes between commits
   - Can filter by specific table

---

## Phase 5: Documentation & Configuration

### 5.1 Build Guide
**File:** `docs/BUILD-DOLTLITE.md` (204 lines)

**Sections:**
1. **Prerequisites** — Node.js 22+, GCC/Clang, zlib, pthread
2. **Step 1: Build doltlite** — Configure & make
3. **Step 2: Patch better-sqlite3** — Run patch-doltlite.mjs
4. **Step 3: Install & run** — npm install, npm run build
5. **Step 4: Verify** — Doctor command
6. **Architecture** — How the patch works
7. **Database format** — CTLD header instead of SQLite format 3
8. **WAL compatibility** — Single-file storage details
9. **Version control via SQL** — Dolt operations
10. **Updating doltlite** — Rebuild process
11. **Troubleshooting** — Common issues & fixes

### 5.2 README Updates
**Commits:**
- `a8bbcdd` — "Add doltlite references to README"
- `74c0dca` — "Doltlite is required, not opt-in"

**Changes:**
- Updated installation instructions
- Made doltlite required (not optional)
- Added verification step: `/context-mode-doltlite:ctx-doctor`
- Documented all 19 MCP tools with categories:
  - 6 sandbox tools
  - 3 utility tools (doctor, stats, upgrade)
  - 2 database management tools
  - 4 doltlite version control tools
  - 4 convoy/work-tracking tools

---

## Phase 6: Bug Fixes & Refinements

### 6.1 WAL Alignment Fix
**Commit:** `19f241e` — "Align WAL handling with doltlite single-file storage (doltlite#118)"

- Implemented after doltlite's Manifest V6 upgrade
- Single-file WAL integrated into main database
- No `-wal` or `-shm` sidecar files created

### 6.2 Patch Script Robustness
**Commit:** `ad38387` — "Patch-doltlite.mjs checks root before build/ for libdoltlite.a"

- Script now checks both root and build/ for library location
- Improved path resolution for different build configurations
- Better error messages for missing artifacts

---

## Summary of Key Changes

| Category | Changes | Files Modified | LOC Added |
|----------|---------|-----------------|-----------|
| **Native Patching** | Patch script, WAL skipping, doctor checks | 4 files | 207 |
| **Database Abstraction** | Database parameter on 6 tools | 2 files | ~50 |
| **Bead Schema** | Convoy/bead/dependency tables | 2 files | ~80 |
| **Version Control** | Git-like SQL operations | 1 file | ~100 |
| **Project Docs** | 5 new tables + 6 MCP tools | 2 files | 199 |
| **Documentation** | BUILD-DOLTLITE.md, README updates | 3 files | 250+ |
| **Total** | **6 phases, ~17 commits over 2 weeks** | **14+ files** | **~900+ lines** |

---

## Breaking Changes

1. **Doltlite is now required**
   - No SQLite fallback in this fork
   - Install requires building libdoltlite.a
   - `npm install` auto-runs patch script

2. **Database files are not SQLite compatible**
   - Use `CTLD` format header (not `SQLite format 3`)
   - Standard SQLite tools cannot open them
   - Only doltlite-patched better-sqlite3 can read/write

3. **WAL pragmas skipped on doltlite**
   - Old code relying on `journal_mode = WAL` won't work
   - Doltlite manages journaling internally
   - Backward compatible: auto-detects via `doltlite_engine()` query

---

## Installation Verification Checklist

```bash
# Build doltlite
cd /data/projects/doltlite/build && ../configure && make doltlite-lib

# Patch context-mode
cd /data/projects/claude-context-mode && npm install

# Verify
/context-mode-doltlite:ctx-doctor
# Expected: all [x] checks pass
# - Doltlite: PASS — engine: prolly
```

---

## Files Modified Summary

### Source Code
- `src/db-base.ts` — WAL pragma handling
- `src/cli.ts` — Doctor command enhancements
- `src/server.ts` — New MCP tools for docs & version control
- `src/store.ts` — Project docs schema definitions
- `scripts/patch-doltlite.mjs` — Doltlite patching logic
- `scripts/postinstall.mjs` — Auto-run patch script

### Configuration & Build
- `package.json` — Dependencies (optional better-sqlite3 now used)
- Bundled files updated: `cli.bundle.mjs`, `server.bundle.mjs`

### Documentation
- `README.md` — Installation, tools reference
- `docs/BUILD-DOLTLITE.md` — Full build pipeline
- `docs/platform-support.md` — Platform-specific notes

### Metadata
- `.github/workflows/` — CI updates for doltlite builds
