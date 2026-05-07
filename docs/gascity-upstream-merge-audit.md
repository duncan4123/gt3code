# Gas City Upstream Merge Audit

Date: 2026-05-07

Formula: `mol-gascity-upstream-merge`

## Scope

- repo: `/data/projects/t3code`
- target branch: `ship`
- upstream ref: `upstream/main`
- T3Code integration branch required by formula:
  `integration/gascity-upstream-sync`
- runtime city: `/data/projects/t3code/packages/gascity-config/config`
- package source: `packages/gascity/source`
- package wrapper: `packages/gascity`

Observed refs after `git fetch --prune --all`:

```text
target   91200a45a9190584d80780bd281c5b873cb15a38
upstream a74ed8ed32c2a949ec6fc91b9ae57c25ac96359a
base     0e388706470fdf8df7b5b5ae37f12bbeea777e06
ahead/behind upstream/main...ship: 10 125
```

## Current Working Tree

The working tree is dirty with in-scope fork work. This blocks any direct
merge into `ship`.

Dirty in-scope paths include:

- `apps/server/src/gc/Layers/GcApiClient.ts`
- `apps/web/src/components/Sidebar*.tsx`
- `packages/contracts/src/gc.ts`
- `packages/contracts/src/settings.ts`
- `packages/gascity-config/config/city.toml`
- `packages/gascity/source/cmd/gc/*`
- `packages/gascity/source/internal/beads/doltlite_read_store.go`
- `packages/gascity/source/internal/events/recorder.go`
- `packages/gascity/source/internal/runtime/t3bridge/provider.go`

Untracked state:

- `.backups/hq-doltlite-gc-20260506-070552/hq.db`

Decision: do not merge upstream in this tree until the dirty work is committed,
stashed, or moved to the declared integration branch.

## Upstream Delta

Upstream commits not on `ship`:

- `536dcad19` Reduce timeline row rerenders
- `25c9d267a` Stabilize git workspace and terminal tests
- `1498335e3` Optimize MessagesTimeline work row stability
- `166bce038` Feature/intellij editors
- `a2ff50dbb` Add process and trace diagnostics views
- `499f1463d` Split server CLI into focused submodules
- `22384ae97` Adopt Effect JSON and DateTime idioms
- `449e1aaa4` Make changed-files header sticky in chat timeline
- `6c79039ce` Cache desktop build assets in CI and release workflows
- `a74ed8ed3` Revert "Cache desktop build assets in CI and release workflows"

High-risk overlap:

- upstream refactors server CLI and diagnostics surfaces
- upstream changes web timeline/rendering paths
- upstream does not contain the fork-owned GC bridge/server module paths
- upstream does not contain the fork-owned `packages/beads-doltlite` package
- upstream does not contain the fork-owned `packages/gascity` package source

## Blocking Finding

A mechanical merge from `upstream/main` would conflict semantically with the
fork-owned GC/T3 bridge. Diffing `ship..upstream/main` shows upstream lacks or
would remove these fork-owned surfaces:

- `apps/server/src/gc/**`
- `apps/web/src/components/GcContextSidebar.tsx`
- `apps/web/src/components/GcPanel.tsx`
- `apps/web/src/components/SidebarGcFolders.tsx`
- `apps/web/src/components/sidebar/gcSidebarControls.ts`
- `apps/web/src/lib/gcThreadContext.ts`
- `apps/web/src/lib/orchestrationReactQuery.ts`
- `packages/beads-doltlite/**`
- many T3 persistence sidecar migrations used by the fork

Decision: block direct merge. Use a reasoned synthesize merge on
`integration/gascity-upstream-sync`.

## T3 Bridge Contract Inventory

| Part | Direction | Source markers | Failure if lost | Smoke check | Status |
| --- | --- | --- | --- | --- | --- |
| GC API client contract | GC -> T3 | `packages/contracts/src/gc.ts`, `apps/server/src/gc/Services/GcApiClient.ts` | Sidebar/API calls disappear | `bun gc status`, RPC `gc.getConfig` | preserve |
| GC API implementation | GC -> T3 | `apps/server/src/gc/Layers/GcApiClient.ts` | lifecycle controls fail | `getLifecycleStatus`, start/stop buttons | dirty, preserve |
| GC context provider | GC -> T3 | `apps/server/src/gc/Layers/GcContextProvider.ts` | right sidebar loses bead/formula/env context | open GC managed thread | preserve |
| Thread binding lookup | bidirectional | `apps/server/src/gc/peek.ts` | session->thread resolution fails | `findThreadBinding` | preserve |
| Folder metadata | GC -> T3 | `apps/server/src/gc/folderMetadata.ts` | virtual folders collapse | sidebar with rig project | preserve |
| Provider env handoff | T3 -> GC provider | `ProviderCommandReactor.ts`, `packages/contracts/src/provider.ts` | agents lose `GC_SESSION_NAME` etc. | provider start input includes env | preserve |
| Custom metadata store | GC -> T3 web | `apps/web/src/store.ts` | GC threads vanish or stop updating | metadata-only update | preserve |
| Terminal/project env | T3 -> shell | `ChatView.tsx`, project script launchers | shells lack GC env | terminal env audit | preserve |
| Sidebar GC folders | GC -> T3 UI | `Sidebar.tsx`, `SidebarGcFolders.tsx` | rigs/pools/named sessions missing | sidebar shows rig/project folders | dirty, preserve |
| Right sidebar panel | GC -> T3 UI | `GcPanel.tsx`, `GcContextSidebar.tsx`, chat route | no bead/formula/convoy/runtime panel | `panel=gc` route | preserve |
| FTS5 search | T3 persistence -> UI | `orchestrationReactQuery.ts`, FTS migrations | sidebar search degraded | message text search | preserve |
| Projection sidecar | T3 persistence | `NodeSqliteClient.ts`, migrations, `packages/doltlite/index.ts` | read model missing columns/tables | fresh dev DB migrations | preserve |
| OpenCode/Kimi defaults | shared config | `city.toml`, `pack.toml`, settings | wrong provider/model for agents | config show provider rows | dirty, preserve |
| Bundled runner env | T3 -> GC | `scripts/gascity-runner.ts`, bundled env helpers | wrong binary/db/backend | `bun gascity:path` | preserve |
| t3bridge provider | GC -> T3 | `packages/gascity/source/internal/runtime/t3bridge` | GC sessions cannot start T3 threads | session start via t3bridge | dirty, preserve |
| Dolt backend | beads storage | beads/gascity backend paths | managed Dolt compatibility lost | bd init backend=dolt | preserve |
| doltlite backend | beads storage | `packages/doltlite`, `packages/beads-doltlite`, `doltlite_read_store.go` | current runtime backend breaks | bd/gc against doltlite DB | dirty, preserve |

## Difference Ledger

| Surface | Upstream change | Fork feature affected | Decision | Verification |
| --- | --- | --- | --- | --- |
| `apps/server/src/cli*` | upstream splits CLI into focused modules | GC server layer imports/wiring | synthesize upstream CLI split while preserving GC layers | targeted server tests |
| `apps/server/src/gc/**` | absent upstream | GC API client, context, generated client | keep fork; port to any new server architecture manually | GC RPC smoke |
| `apps/server/src/persistence/Migrations/*` | upstream has later migration shape, fork has sidecar/FTS/provider-instance work | projection sidecar, FTS5, provider instance IDs | synthesize; never drop sidecar/FTS migrations silently | fresh dev DB boot |
| `apps/web/src/components/Sidebar.tsx` | upstream timeline/sidebar changes overlap with fork GC virtual folders | rig/project grouping, pool controls, thread rows | synthesize; keep top-level project semantics and GC virtual folders | sidebar tests/manual UI |
| `apps/web/src/components/SidebarGcFolders.tsx` | absent upstream | GC agent/rig/session controls | keep fork | sidebar renders configured agents |
| `apps/web/src/components/GcContextSidebar.tsx` | absent upstream | right sidebar context panel | keep fork | `panel=gc` route |
| `apps/web/src/components/chat/MessagesTimeline*` | upstream performance work | GC activity cards and timeline entries | synthesize if timeline touched | timeline tests |
| `packages/gascity/**` | absent upstream T3Code | bundled GC build/runtime | keep fork; sync from Gas City rig formula, not T3 upstream | `bun build:gascity-tools` |
| `packages/beads-doltlite/**` | absent upstream T3Code | doltlite-backed beads | keep fork; sync from beads-doltlite rig formula | bd doltlite smoke |
| `packages/doltlite/**` | absent upstream T3Code | linked libdoltlite client | keep fork | native build smoke |
| `packages/gascity-config/**` | absent upstream T3Code | bundled city/rig/packs/providers | keep fork; sync via HQ formula | `bun gc config show` |

## Rig Sync Plan

See `docs/gascity-rig-repo-matrix.md`.

Summary:

- `gascity`: repo-backed rig, dirty, requires `mol-rig-upstream-sync` before
  package source can be refreshed.
- `beads-doltlite`: repo-backed rig, dirty docs, requires
  `mol-rig-upstream-sync` before package source can be refreshed.
- `context-mode`: repo-backed rig but suspended and separate from Gas City
  update; defer unless bridge/context-mode package interaction is in scope.
- T3Code package assembly must occur on
  `integration/gascity-upstream-sync`, not directly on `ship`.

## Result Of This Run

Formula execution status: audit complete, merge blocked.

Blocked because:

1. dirty in-scope fork work exists on `ship`
2. upstream has a real delta now
3. upstream lacks the fork GC bridge/package surfaces
4. rig-local sync formula outputs have not been produced for `gascity` and
   `beads-doltlite`

No merge, rebase, checkout, or conflict resolution was performed.

## Next Merge Procedure

1. Commit or stash current dirty work as fork-preservation commits.
2. Create/check out `integration/gascity-upstream-sync`.
3. Run `mol-rig-upstream-sync` in `/data/projects/gascity`.
4. Run `mol-rig-upstream-sync` in `/data/projects/beads-doltlite`.
5. Consume audited rig outputs into T3 packages.
6. Merge/synthesize upstream T3Code changes, preserving every bridge entry in
   this audit and `docs/gascity-fork-feature-ledger.md`.
7. Run focused smoke checks. Do not run full `bun typecheck` unless explicitly
   requested.
