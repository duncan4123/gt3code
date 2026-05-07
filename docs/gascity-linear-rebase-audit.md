# Gas City Linear Rebase Audit

Date: 2026-05-07

## Branches

- Upstream base: `/data/projects/gascity-rebase-main-20260507T203904`, `upstream/main`
- Linear candidate: `/data/projects/gascity-rebase-main-20260507T203904`, `rebase/t3-session-bridge-main-20260507T203904`
- Merge reference: `/data/projects/gascity-upmerge-20260507T043506Z`, `upmerge/t3-session-bridge-20260507T043506Z`
- Vendored package reference: `/data/projects/t3code/packages/gascity/source`

## Linear Candidate Summary

The rebase is complete and clean. It is `upstream/main + 25` linear commits.

The candidate differs from the previous scratch merge only by the remote-only Doltlite runtime env fix:

- `cmd/gc/bd_env.go`
- `cmd/gc/cmd_supervisor_lifecycle.go`
- `examples/bd/assets/scripts/gc-beads-bd.sh`

Targeted validation passed:

- `go test ./internal/beads -run 'Test.*Doltlite|TestCachingStoreBd'`
- `go test ./cmd/gc -run 'TestBdRuntimeEnvDoltliteBackendClearsDoltProjection|TestCheckHardDependenciesDoesNotRequireDoltForDoltliteBdBackend|TestBuiltinPackIncludes_BdDoltliteBackendSkipsDolt|TestBuildStartupEnvelope|TestStartupEnvelopeModel|TestCityRuntimeBuildDesiredState_StandaloneIncludesRigStores|TestRenderSupervisor(Systemd|Launchd)Template|TestBuildSupervisorServiceData'`

## Preserved Feature Groups

- Native T3 bridge runtime under `internal/runtime/t3bridge`.
- Startup envelope plumbing and GC runtime identity projection.
- Session bead behavior and named session identity normalization.
- Doltlite backend mode, Dolt preflight skip, direct Doltlite read store, and direct work-demand read paths.
- API/status provider additions used by T3 sidebar/runtime integration.
- Supervisor install env persistence, including Doltlite runtime env from the remote feature tip.
- Safe upmerge formula/docs.
- Prompt guardrails and shared worktree script links.

## Package-Only Concepts Still Needing Reasoned Port

These exist in the T3Code vendored package but are not fully present in the rebased Gas City repo.

1. OpenCode model options in T3 bridge
   - Package adds `t3ModelSelection(provider, model, agent, variant)`.
   - Package passes `GC_OPENCODE_AGENT` and `GC_OPENCODE_VARIANT` into project/thread/turn model selections.
   - Package stores `gc.openCodeAgent` and `gc.openCodeVariant` in thread metadata.
   - Rebased repo currently only passes provider/model.
   - Port intent, but align with upstream `Provider` command helpers and tests.

2. Provider-aware project workspace root
   - Package makes `deriveProjectWorkspaceRoot(workDir, envelope, provider)` return `workDir` for Codex.
   - Rebased repo uses `deriveProjectWorkspaceRoot(workDir, envelope)` and prefers rig path.
   - Needs product decision: this changes T3 project grouping semantics.

3. Startup envelope thread reuse in `cmd/gc/template_resolve.go`
   - Package sets `allowThreadReuse := wakeMode != "fresh"`.
   - Rebased repo still writes `allowThreadReuse: true` in the command-side envelope builder.
   - Internal `t3bridge/envelope.go` already has `allowThreadReuse(kind, wakeMode)`, so command-side behavior should likely be aligned.

4. Doltlite scope metadata seeding
   - Package has `ensureDoltliteScopeMetadataForInit` and `seedDoltliteBeadsForConfiguredScopes`.
   - Rebased repo has Doltlite backend support but not those package init helpers.
   - Port carefully so Dolt-backed bd still uses canonical Dolt config paths and Doltlite skips Dolt runtime setup.

5. Doltlite SQL opening and direct helpers
   - Package has `internal/beads/doltlite_sql.go` and uses `openDoltliteSQL`.
   - Package adds direct helpers: `Children`, `ListByLabel`, `ListByAssignee`, `ListByMetadata`.
   - Package `Ready()` is stale: it lacks upstream `Ready(query ...ReadyQuery)`.
   - Port helpers only after preserving the upstream `Ready(query ...ReadyQuery)` interface.

6. Event recorder tail scan
   - Package changes `internal/events/recorder.go` to initialize sequence by scanning the event log tail.
   - Rebased repo does not show the package `reading event log tail` path.
   - Port if still needed for large event logs; add/keep a focused test.

7. Pool demand and pool slot stamping
   - Package has `evaluateDefaultPoolDemand` and `stampPoolSlotIdentity`.
   - Rebased repo has direct `PoolDemandCount` support but not the package’s exact desired-state/stamping helpers.
   - Needs comparison against upstream’s newer pool identity fixes before copying; preserve the intent, not necessarily the implementation.

## Sync Guidance

Do not copy the T3Code package over the rebased repo wholesale. The package is behind upstream in many files and includes stale interfaces.

Preferred next steps:

1. Port the package-only concepts above into the rebased repo one topic at a time.
2. Run targeted Go tests after each topic.
3. Once the rebased repo is source of truth, refresh `packages/gascity/source` from it while excluding runtime/generated artifacts.
4. Build/install `gc` from the rebased repo source.
