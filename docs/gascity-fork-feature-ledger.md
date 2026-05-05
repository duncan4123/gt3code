# Gas City Fork Feature Ledger

As of 2026-05-06, `ship` is 116 commits ahead of `upstream/main` and 0 commits
behind it:

```bash
git rev-list --left-right --count upstream/main...ship
# 0 116
```

Current merge-base and target refs:

```bash
git merge-base ship upstream/main
# 35721d9a08b225c4a3752f322ae4daccbeaa564e

git rev-parse upstream/main
# 35721d9a08b225c4a3752f322ae4daccbeaa564e
```

That means there is no incoming upstream drift to reconcile on 2026-05-06. The
job of this ledger is to record the fork-only behavior that must survive the
next upstream sync.

## Must-Preserve Feature Groups

### 1. Bundled Gas City source tree in T3Code

`packages/gascity/source/` is a fork-local vendor/import of Gas City, carried
inside the T3Code monorepo and advanced on `ship`.

Preserve:

- full `packages/gascity/source/` tree and repo metadata
- Gas City docs under `packages/gascity/source/engdocs/`
- packaged formulas, prompts, examples, and tutorial goldens

Why it matters:

- `upstream/main` does not carry this T3Code package path
- any future upmerge can only be safe if this tree is treated as a fork-owned
  integration surface, not a disposable subtree

### 2. Native T3 bridge inside bundled Gas City

Branch history and bundled docs show a fork-only T3 provider stack:

- `internal/runtime/t3bridge/`
- `cmd/gc/providers.go`
- `cmd/gc/template_resolve.go`
- `cmd/gc/cmd_session_audit_env.go`
- API/status/dashboard support paths including `cmd/gc/cmd_citystatus.go` and
  `cmd/gc/cmd_dashboard.go`

Commits called out by existing bundled history docs:

- `0e57bb0b` `feat(t3bridge): add native T3 provider`
- `f0e23f49` `feat: make t3bridge first-class`
- `1d76c1f3` `fix: make t3bridge auth native`
- `6bb6a8ab` `feat(gc): land t3 bridge and api fixes`

Preserve:

- native provider startup envelope generation
- T3 session reuse behavior
- provider selection and template-resolution wiring
- session audit tooling for T3-managed environments
- status/dashboard/API plumbing needed by T3 surfaces

### 3. Dual beads backend support, including doltlite

Fork history after the bundled import keeps pushing Gas City toward real
doltlite compatibility instead of managed-Dolt-only behavior.

Recent branch-only commits in this area:

- `6c62a1be3` `Fix doltlite rig store initialization`
- `aae4d7ba2` `fix(beads): report configured backend`
- `06911b4cc` `fix: link bd builds against doltlite`
- `74c8cdaac` `fix(gc): carry rig stores in one-shot start`
- `3f271abcf` `fix(gascity): extend beads init timeout`

Fork-owned evidence in the tree:

- `packages/gascity/source/README.md`
- `packages/gascity/source/Makefile`
- `packages/gascity/source/engdocs/architecture/beads.md`
- `packages/gascity/source/examples/gastown/packs/maintenance/orders/doltlite-compact.toml`
- `docs/gascity-doltlite-runtime-notes.md`
- `docs/gc-doltlite-compatibility-matrix.md`
- `packages/beads-doltlite/source/`

Preserve:

- `backend = "doltlite"` support in Gas City bead/provider flows
- rig-store initialization semantics
- backend provenance reporting
- one-shot startup carrying rig stores correctly
- build/link assumptions that let bundled `gc` and `bd` speak to doltlite

### 4. T3 host-app integration around bundled Gas City

The fork delta is not limited to `packages/gascity/source/`. T3Code also
contains host-app integration layers around the bundled GC runtime.

Observed fork-owned paths:

- `apps/server/scripts/generate-gc-client.ts`
- `apps/server/scripts/patch-doltlite.mjs`
- `apps/web/src/components/sidebar/gcSidebarControls.ts`
- `apps/web/src/session-logic.ts`
- `apps/web/src/session-logic.test.ts`
- `docs/design-gc-sidebar-integration.md`
- `docs/gc-backend-provider-replacement-contract.md`
- `docs/gc-nudge-contract.md`
- `docs/gc-sidebar-live-audit.md`

Preserve:

- generated-client and patching flow for GC integration
- web sidebar controls and session behavior that assume GC/T3 coupling
- contract docs that describe the expected bridge and backend behavior

### 5. Merge safety knowledge already encoded in bundled docs

The fork already contains merge-risk documentation that should be treated as
load-bearing during the next sync:

- `packages/gascity/source/engdocs/contributors/t3-session-bridge-history-summary.md`
- `packages/gascity/source/engdocs/contributors/t3-session-bridge-merge-checklist.md`
- `packages/gascity/source/engdocs/contributors/safe-upmerge-formula.md`

Preserve:

- known hot spots: `cmd/gc/template_resolve.go`, `cmd/gc/session_beads.go`,
  `cmd/gc/beads_provider_lifecycle.go`, `internal/runtime/t3bridge/provider.go`
- scratch-worktree upmerge flow
- explicit warning that config false-vs-omitted semantics can regress

## Hot Paths To Re-Check On Every Upmerge

- `packages/gascity/source/cmd/gc/template_resolve.go`
- `packages/gascity/source/cmd/gc/providers.go`
- `packages/gascity/source/cmd/gc/session_beads.go`
- `packages/gascity/source/cmd/gc/beads_provider_lifecycle.go`
- `packages/gascity/source/cmd/gc/cmd_status.go`
- `packages/gascity/source/cmd/gc/cmd_citystatus.go`
- `packages/gascity/source/cmd/gc/cmd_dashboard.go`
- `packages/gascity/source/cmd/gc/cmd_doctor.go`
- `packages/gascity/source/internal/runtime/t3bridge/`
- `packages/gascity/source/internal/api/`
- `packages/beads-doltlite/source/`
- `apps/server/scripts/generate-gc-client.ts`
- `apps/server/scripts/patch-doltlite.mjs`
- `apps/web/src/components/sidebar/gcSidebarControls.ts`
- `apps/web/src/session-logic.ts`

## Bottom Line

The next upstream merge is not mainly about pulling new upstream code. As of
2026-05-06 there is none beyond the current merge-base. The real risk is losing
T3Code-owned integration work when the bundled Gas City tree is refreshed or
rebased. Any future upmerge should begin from this ledger and treat each group
above as required parity, not optional local customization.
