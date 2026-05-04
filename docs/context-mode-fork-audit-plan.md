# Context Mode Fork Audit Plan

## Scope

Fork checkout: `/data/projects/claude-context-mode`

Fork remote: `origin git@github.com:sfncore/claude-context-mode.git`

Upstream remote: `upstream https://github.com/mksglu/context-mode.git`

Baseline compared: `upstream/main...main`

Observed state:

- fork branch: `main`
- merge base: `fba3b0e796fd755bb803a4d3ae7a9b7d32d79e16`
- fork is `108` commits ahead and `1` commit behind `upstream/main`
- missing upstream commit: `78b2428 ci: update install stats`
- upstream `next` is one additional commit beyond upstream `main`
- local fork checkout is dirty: `.gitignore`, `.orphaned_at`

## Diff Map

Overall diff: 163 files, about 8,904 additions and 1,768 deletions, plus native binary prebuilds.

Important areas:

1. Plugin identity and Claude install surface
   - `.claude-plugin/plugin.json`
   - `.claude-plugin/marketplace.json`
   - `.claude-plugin/hooks/hooks.json`
   - `package.json`
   - risk: package name is `context-mode-doltlite`, plugin name remains `context-mode`, MCP key is `context-mode-doltlite`.

2. Upgrade, launcher, and self-heal path
   - `start.mjs`
   - `src/cli.ts`
   - `scripts/postinstall.mjs`
   - `skills/ctx-upgrade/SKILL.md` deleted
   - risk: updater may still assume upstream repo/name/cache layout, or may be disabled where fork needs self-heal.

3. Adapter configs and hook names
   - `configs/codex/config.toml`
   - `configs/codex/hooks.json`
   - `configs/opencode/opencode.json`
   - `src/adapters/claude-code/*`
   - `src/adapters/codex/index.ts`
   - `src/adapters/opencode/index.ts`
   - `hooks/codex/*`
   - risk: direct global provider config conflicts with Gas City-owned projection; hook matchers must use actual MCP names.

4. MCP restart and registry recovery
   - `src/mcp-registry.ts`
   - `tests/mcp-registry.test.ts`
   - `tests/mcp-restart-recovery.test.ts`
   - risk: stale PID cleanup must not kill unrelated processes and must resolve project roots consistently.

5. Doltlite storage and native addon packaging
   - `src/db-base.ts`
   - `src/store.ts`
   - `vendor/better-sqlite3/**`
   - `prebuilds/**`
   - `scripts/patch-doltlite.mjs`
   - `docs/BUILD-DOLTLITE.md`
   - risk: ABI, loader path, vanilla SQLite fallback, and CPU-heavy rebuild loops.

6. Tool and resource policy
   - `src/resource-policy.ts`
   - `src/server.ts`
   - `tests/resource-policy.test.ts`
   - risk: sandbox/SSRF/process execution guardrails can drift from upstream security fixes.

7. Gas City-specific additions
   - `.claude/skills/gc-*`
   - `scripts/*.sh`
   - `skills/context-mode-ops/*`
   - risk: bundled skills/scripts may assume local filesystem paths and should not leak into upstream plugin install behavior unless intended.

8. Generated bundles
   - `server.bundle.mjs`
   - `cli.bundle.mjs`
   - `hooks/session-db.bundle.mjs`
   - risk: bundles can hide source/bundle drift; audit source first, then rebuild and compare.

## Audit Plan

### Phase 1: Identity and Install Contract

Goal: decide the canonical fork identity across npm, Claude plugin, MCP server key, and CLI.

Checks:

- Confirm whether Claude marketplace key remains `context-mode@context-mode`.
- Confirm whether MCP server key must be `context-mode` or `context-mode-doltlite`.
- Confirm `installed_plugins.json` should point only to versioned cache, never `plugins/marketplaces`.
- Verify `.claude-plugin/plugin.json` metadata uses fork repo/package consistently.

Exit criteria:

- One identity matrix exists for package name, plugin name, MCP key, CLI bin, repo URL, and cache path.
- Tests or fixture checks cover plugin metadata and generated marketplace files.

### Phase 2: Upgrade and Self-Heal

Goal: make fork updates follow upstream cache pattern but pull from `sfncore/claude-context-mode`.

Checks:

- Trace `start.mjs` self-heal and registry repair behavior.
- Trace `ctx_upgrade` or replacement CLI path.
- Remove any fallback clone/update path to `mksglu/context-mode.git` unless explicitly upstream-sync-only.
- Verify stale marketplace directories are ignored or repaired.

Exit criteria:

- Fresh install, stale cache, stale marketplace process, and version bump scenarios are scripted.
- Upgrade path updates cache, registry, hooks, and restart behavior.

### Phase 3: Provider Ownership Boundaries

Goal: keep provider configs owned by their real orchestrator.

Checks:

- Claude: plugin marketplace/cache owns Claude MCP and hooks.
- Codex in T3/Gas City: Gas City projects MCP into workdir-local `.codex/config.toml`.
- OpenCode in T3/Gas City: no direct global context-mode plugin/MCP unless Gas City implements OpenCode projection.
- Standalone docs/config examples stay valid for non-Gas-City users.

Exit criteria:

- T3/Gas City install does not write global Codex/OpenCode context-mode config.
- Standalone configs clearly marked as manual examples.

### Phase 4: Doltlite Native Runtime

Goal: prove native Doltlite addon loading is deterministic and never rebuilds in a loop.

Checks:

- Loader prefers shipped prebuilds by ABI.
- `doltlite_engine()` verification rejects vanilla SQLite.
- `postinstall` and `patch-doltlite` do not run during normal MCP startup.
- Missing ABI path fails with actionable error, not CPU churn.

Exit criteria:

- Matrix covers Node ABI 127 and 137.
- Startup logs identify exact addon path and Doltlite marker.

### Phase 5: Security Backports

Goal: verify fork preserved upstream hardening while adding local features.

Checks:

- Diff fork against `upstream/main` and `upstream/next` for `src/resource-policy.ts`, `src/server.ts`, HTTP fetch/index paths, shell execution, and redaction.
- Map upstream security commits after merge base to fork commits.
- Add focused tests for SSRF guard, shell allowlist, path confinement, and redaction.

Exit criteria:

- Security commit mapping shows each upstream fix as present, intentionally replaced, or pending.

### Phase 6: Runtime Process Hygiene

Goal: prevent stale/high-CPU process recurrence.

Checks:

- MCP registry records include project root, version, command, and launcher path.
- Restart only kills known context-mode processes.
- Stale Claude marketplace process is detected and cleaned.
- OpenCode plugin child processes are not launched from stale global config in T3.

Exit criteria:

- Repro test starts old-path process and verifies self-heal/cleanup.

### Phase 7: Bundle and Release Verification

Goal: ensure source and published artifacts match.

Checks:

- Rebuild bundles from clean tree.
- Compare `server.bundle.mjs`, `cli.bundle.mjs`, and hook bundles.
- Verify `files` list includes all runtime-critical assets and excludes repro/dev-only material unless intended.

Exit criteria:

- Release checklist includes source build, artifact diff, install test, and smoke run.

## Suggested Command Set

Run from `/data/projects/claude-context-mode`:

```sh
git fetch upstream origin
git diff --stat upstream/main...main
git diff --name-status upstream/main...main
git log --oneline main..upstream/main
git log --oneline upstream/main..main -- package.json .claude-plugin start.mjs src scripts configs hooks tests
npm test
npm run build
```

Run from `/data/projects/t3code` after Gas City integration changes:

```sh
bun --filter @t3tools/gascity build
go test ./cmd/gc -run TestIsStage2EligibleSession -count=1
go test ./internal/runtime/t3bridge -count=1
bun gc -- mcp list --session <codex-session-id>
```
