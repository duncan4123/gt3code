# Gastown Workflow Audit

This audit focuses on the scripts, formulas, and prompts that actually run
work through GasCity, not the T3Code UI surface.

## Runtime Surface

- `packs/gastown/pack.toml` declares the role graph, named sessions, provider
  defaults, dog pool controls, and script hooks.
- `agents/*/agent.toml` controls scope, wake mode, provider/model, work
  directory, `pre_start`, `session_live`, and pool min/max.
- `agents/*/prompt.template.md` tells each live agent how to behave after
  `gc prime`.
- `formulas/*.toml` is the durable workflow contract. These files dispatch
  work, write bead metadata, route work through pools, and recover after
  restarts.
- `scripts/*.sh` is T3Code's relocated copy of upstream
  `assets/scripts/*.sh`; all references must stay consistent with that layout.
- `commands/*` and `doctor/*` expose operator commands and health checks.

## High-Risk Drift From Upstream

- Upstream now routes most workflow bead operations through `gc bd ...`.
  T3Code formulas still use many bare `bd ...` commands. Bare `bd` can be fine
  inside a correctly primed session, but it is weaker across tool shells,
  Doltlite/Dolt backend selection, and city/rig store boundaries.
- Upstream prompts and fragments now include a build/test execution guard:
  do not run builds or tests unless explicitly asked. T3Code's
  `tdd-discipline` still instructs agents to run tests after changes.
- Upstream polecat/refinery formulas use `{{binding_prefix}}` and
  `${GC_RIG:+$GC_RIG/}` when writing `gc.routed_to`. T3Code has literal
  `<rig>/...` examples in important handoff paths, which is not executable and
  can strand beads outside the intended pool.
- Upstream witness recovery uses exact session liveness from
  `gc session list --state=all --json` plus session bead metadata. T3Code's
  witness formula is older and can misclassify restarted pool work.
- Upstream refinery workflow preserves and validates `existing_pr`, records
  canonical `pr_url`, and uses workflow cleanup/reopen paths on rejection.
  T3Code's formula is older and loses parts of that handoff.
- Upstream operational awareness changed Dolt diagnostics to non-fatal
  collection first. T3Code's generic Dolt fragment still recommends `SIGQUIT`
  early. In Doltlite mode, prompts must use the Doltlite fragment and must not
  invent `gc dolt ...` recovery steps.

## T3Code-Specific Features To Preserve

- Extra roles: `crew`, `convoymaster`, `hq-polecat`, `hq-refinery`,
  `hq-witness`.
- Kimi/OpenCode provider defaults for the configured build agents.
- T3Code script relocation from upstream `assets/scripts` to `scripts`.
- `worktree-setup.sh` fix that ensures `.codex` is a directory in fresh
  worktrees.
- Dog pool min/max controls and `wake_mode = "fresh"` exposed in the sidebar.
- Doltlite operational fragment and runtime smoke-check expectations.
- Merge/sync formulas:
  - `mol-gascity-upstream-merge`
  - `mol-rig-upstream-sync`
  - `mol-context-mode-upstream-merge`
  - `mol-gastown-pack-convoy`
  - `mol-t3-sidebar-live-audit`

## Merge Direction

Use upstream as the workflow baseline, then reapply T3Code-specific features
deliberately:

1. Adopt upstream formula versions and prompt guardrails where they describe
   core Gastown behavior.
2. Keep T3Code provider/model, role additions, script layout, and Doltlite
   details.
3. Normalize executable examples to real rendered targets, not placeholders.
4. Prefer `gc bd` in workflow formulas unless the code path explicitly requires
   direct `bd`.
5. Recheck every metadata contract that ties workflow to runtime:
   `work_dir`, `branch`, `target`, `existing_pr`, `pr_url`, `gc.routed_to`,
   session identity, convoy IDs, and pool slot identity.
