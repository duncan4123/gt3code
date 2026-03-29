# T3Code Upstream Sync Guide

## The Problem

t3code is a fork of pingdotgg/t3code with custom additions:
- Doltlite persistence layer (DoltliteClient, dolt_commit cycle, FTS sidecar)
- Gas City integration (customMetadata on threads, GC panel, sidebar GC functions)
- Thread message search (FTS5, search query service, WS endpoint)
- Custom migrations (016-019 in our numbering)

Upstream makes large refactors (e.g. Effect.fn annotation changes across entire files). Our additions are scattered throughout the same files. Standard `git merge` produces conflicts that are hard to resolve because both sides changed the same functions.

## What Goes Wrong

**`checkout --theirs` (taking upstream's version):** Drops our additions silently. You don't notice until runtime when imports fail or features are missing. This is what happened — we lost the dolt_commit cycle, FTS helpers, customMetadata fields, GC sidebar functions, and search types. Each fix revealed another missing piece.

**`checkout --ours` (keeping our version):** Misses upstream's new features and refactors. The code compiles but lacks upstream improvements.

**`git merge-file` (3-way merge):** Works well for files where changes don't overlap. Fails silently on large files where both sides made structural changes — produces clean output that's missing chunks from either side.

## What Works

### For files where only ONE side changed significantly:
Use `git merge` default resolution — it handles these correctly.

### For files where BOTH sides changed:
**Diff/patch approach:**

1. Identify the merge base: `git merge-base HEAD upstream/main`
2. Compute OUR additions as a diff from the merge base:
   ```bash
   diff -u <(git show $MERGE_BASE:path/to/file) <(git show HEAD:path/to/file) > /tmp/our-additions.patch
   ```
3. Start from upstream's version (has their refactors):
   ```bash
   git show upstream/main:path/to/file > path/to/file
   ```
4. Apply our additions:
   ```bash
   patch -p0 path/to/file /tmp/our-additions.patch
   ```
5. Fix rejected hunks manually (usually 1-3 per file, context shifted)
6. Check for duplicates if you already manually added some changes

### For contract/schema files (orchestration.ts, ws.ts, ipc.ts):
These have type definitions scattered throughout. The diff/patch approach works but watch for:
- Duplicate type definitions (if you manually added some before patching)
- Missing field additions on existing types (e.g. `customMetadata` on `OrchestrationThread`)
- Constant value differences (e.g. `DEFAULT_PROVIDER_KIND`)

### For migration files:
Upstream and our fork both add migrations after the last shared one. Resolution:
1. Keep upstream's migration numbers as-is
2. Renumber our migrations to come AFTER upstream's
3. Rename migration files to match new numbers
4. Delete duplicates (e.g. if upstream added the same migration we did)

## Checklist After Merge

Before committing, verify ALL of these:

- [ ] `grep -r "<<<<<<" apps/ packages/` — no conflict markers
- [ ] Every file we modified has our additions (search for key identifiers):
  - `dolt_commit` in ProjectionPipeline.ts
  - `customMetadata` in orchestration.ts
  - `getGcMetadata` in Sidebar.logic.ts
  - `searchThreadMessages` in ws.ts, ipc.ts, wsServer.ts
  - `ftsDbPath` in Sqlite.ts
  - `classifySqliteError` in DoltliteClient.ts
- [ ] No duplicate type/function definitions
- [ ] Migration numbers are sequential with no gaps
- [ ] `bun install` succeeds
- [ ] Server starts without import errors
- [ ] Production test suite passes: `npx vitest run src/persistence/Layers/DoltliteProduction.test.ts`

## Our Fork's Custom Files (not in upstream)

These should never conflict — they're new files:
- `apps/server/src/persistence/DoltliteClient.ts`
- `apps/server/src/persistence/Layers/Sqlite.ts` (heavily modified)
- `apps/server/src/persistence/Layers/DoltliteIntegrity.test.ts`
- `apps/server/src/persistence/Layers/DoltliteProduction.test.ts`
- `apps/server/src/orchestration/Layers/ThreadMessageSearchQuery.ts`
- `apps/server/src/orchestration/Services/ThreadMessageSearchQuery.ts`
- `apps/server/src/persistence/Migrations/016-019_*.ts` (our migrations)
- `apps/web/src/components/GcPanel.tsx`
- `apps/web/src/components/GcContextSidebar.tsx`
- `scripts/doltlite-rebuild.ts`
- `apps/server/scripts/patch-doltlite.mjs`
- `apps/server/docs/doltlite-*.md`

## Our Fork's Modified Files (will conflict on upstream refactors)

These are upstream files with our additions mixed in:
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — dolt_commit cycle, FTS sync, customMetadata
- `packages/contracts/src/orchestration.ts` — CustomMetadata, search types, DEFAULT_PROVIDER_KIND, ThreadActivityAppend
- `packages/contracts/src/ws.ts` — search channel
- `packages/contracts/src/ipc.ts` — search method
- `apps/server/src/wsServer.ts` — search endpoint
- `apps/server/src/serverLayers.ts` — search service wiring
- `apps/web/src/components/Sidebar.logic.ts` — GC metadata functions
- `apps/web/src/components/Sidebar.tsx` — GC panel rendering
- `apps/web/src/components/ChatView.tsx` — GC panel toggle, isWorking fix
- `apps/server/src/persistence/Migrations.ts` — our migration entries
