# Gas City Upstream Merge Audit

Date: 2026-05-06

## Scope

Audit target:

- repo: `/data/projects/t3code`
- branch: `ship`
- upstream ref: `upstream/main`

Observed refs:

```bash
git branch --show-current
# ship

git rev-list --left-right --count upstream/main...ship
# 0 116

git merge-base ship upstream/main
# 35721d9a08b225c4a3752f322ae4daccbeaa564e

git rev-parse ship
# 5bd92c799a0163015afb969918439f859e318f0d

git rev-parse upstream/main
# 35721d9a08b225c4a3752f322ae4daccbeaa564e
```

## Executive Read

There is no new upstream delta to merge on 2026-05-06. `upstream/main` is
already the direct ancestor of `ship`. The audit question is therefore not
"what incoming upstream change will break us today?" but "what fork features
must be preserved when the next upstream refresh happens?"

The answer: preserve the bundled Gas City tree, the native T3 bridge, the
doltlite/beads backend work, and the T3 host-app integration around them.

## Findings

### 1. Current merge pressure from upstream is zero

Evidence:

- `upstream/main...ship` reports `0 116`
- merge-base equals `upstream/main`

Implication:

- a merge from `upstream/main` into `ship` today should be a no-op
- any real conflict work will happen when upstream advances later, or when the
  bundled package is refreshed from a newer upstream snapshot

### 2. The durable fork delta is broad and multi-layered

The `ship`-only delta spans at least four layers:

1. bundled source import: `packages/gascity/source/`
2. backend/runtime dependencies: `packages/beads-doltlite/source/`
3. T3 host integration: `apps/server/*`, `apps/web/*`
4. operating docs/contracts: `docs/*.md`

Implication:

- future merge work cannot be scoped to just the bundled Go package
- T3-side scripts, UI, runtime notes, and backend packaging must be reviewed in
  the same pass

### 3. T3 bridge remains a merge hot spot

Existing bundled history docs already identify these areas as sensitive:

- `packages/gascity/source/cmd/gc/template_resolve.go`
- `packages/gascity/source/cmd/gc/providers.go`
- `packages/gascity/source/cmd/gc/session_beads.go`
- `packages/gascity/source/internal/runtime/t3bridge/`

Why:

- bridge landing came in multiple follow-up commits, not one stable drop
- previous merge fallout already required explicit restore commits for session
  beads and lifecycle behavior
- the bundled docs already warn that `template_resolve.go` and session-bead
  paths are conflict-prone

### 4. Doltlite/backend work is first-class fork behavior, not incidental drift

Recent `ship`-only commits show active backend integration work after the
bundle landed:

- `6c62a1be3` `Fix doltlite rig store initialization`
- `aae4d7ba2` `fix(beads): report configured backend`
- `06911b4cc` `fix: link bd builds against doltlite`
- `74c8cdaac` `fix(gc): carry rig stores in one-shot start`
- `3f271abcf` `fix(gascity): extend beads init timeout`
- `ff21b17a8` `fix(gascity): support runtime help`

Implication:

- upstream sync must not revert T3Code toward managed-Dolt-only assumptions
- smoke checks after any future merge need explicit backend coverage, not just
  generic CLI sanity

### 5. Host-app integration is coupled to the forked runtime

Changed paths outside the bundle include:

- `apps/server/scripts/generate-gc-client.ts`
- `apps/server/scripts/patch-doltlite.mjs`
- `apps/web/src/components/sidebar/gcSidebarControls.ts`
- `apps/web/src/session-logic.ts`
- `apps/web/src/session-logic.test.ts`

Implication:

- a package refresh that compiles inside `packages/gascity/source/` can still
  break T3 if generated client shape, sidebar semantics, or patching scripts
  drift

## Required Preservation Set

Before landing any future upstream refresh, verify parity for:

- bundled Gas City source tree under `packages/gascity/source/`
- native T3 provider behavior under `internal/runtime/t3bridge/`
- provider/template/session-bead lifecycle wiring
- dual backend support for managed Dolt and doltlite
- rig-store initialization and backend provenance reporting
- T3 server/web integration scripts and sidebar/session behavior
- operator docs that explain bridge and backend contracts

See [docs/gascity-fork-feature-ledger.md](/data/projects/t3code/docs/gascity-fork-feature-ledger.md)
for the detailed inventory.

## Recommended Upmerge Shape

When upstream advances, use this sequence:

1. Refresh refs and re-run divergence check against the exact target SHA.
2. Create a scratch worktree from current `ship`.
3. Merge the newer `upstream/main` in scratch, never in the primary dirty tree.
4. Reconcile hot paths first:
   `template_resolve.go`, `providers.go`, `session_beads.go`,
   `beads_provider_lifecycle.go`, `internal/runtime/t3bridge/`, and API/status
   handlers.
5. Re-check T3 host integration paths after bundled-code conflicts are settled.
6. Re-run backend smoke checks against HQ and each rig store if storage-opening
   behavior changed.

Bundled references already carrying the detailed playbook:

- `packages/gascity/source/engdocs/contributors/safe-upmerge-formula.md`
- `packages/gascity/source/engdocs/contributors/t3-session-bridge-merge-checklist.md`
- `packages/gascity/source/engdocs/contributors/t3-session-bridge-history-summary.md`

## What I Did Not Do

- no build, compile, or test run
- no manual HQ/rig backend smoke tests
- no actual merge or rebase

Reason:

- current task was audit/documentation
- workspace instructions explicitly say not to run tests/builds unless asked
- there is no incoming upstream delta to land today

## Conclusion

As of 2026-05-06, `ship` does not need an upstream merge from `upstream/main`.
The useful output is the preservation map for the next sync. The highest-risk
paths remain the T3 bridge, session/beads lifecycle wiring, doltlite backend
behavior, and the T3 host-app integration that depends on them.
