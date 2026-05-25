{{ define "jj-workflow" }}

## JJ Stack Workflow

This rig uses JJ for code changes. Gas City/beads track ownership and lifecycle.
JJ tracks code state. Jorje is the review surface.

- Pack landing target: `staging/current@jorje`.
- Runnable app target: `live/current`.
- Workers and landers never edit `live/current`; a human promotes reviewed
  staging work to live.
- Treat `jj_change` as the durable code-change ID.
- Treat `work_dir` as the active JJ workspace for a bead.
- Use one JJ workspace per active code-writing bead.
- Keep agent state and bead workspaces under `.t3-dev/worktrees/gascity/...`,
  inside the T3 install's shared worktree root but outside the served source tree.
- Workers submit changes; only the lander moves target bookmarks.
- Workers may run focused tests that directly cover their changed files when a
  bead, mayor, or user asks for verification. Workers must not run builds,
  complete test suites, repo-wide gates, or broad generated checks.
- Sentinel verifies workflow health and submitted-change readiness without
  running builds or complete test suites.
- Only the lander may run builds, complete test suites, or broad gates, and only
  when it decides they are needed before landing.
- Prefer stacked changes over broad mixed changes.
- Check `jj status` before handoff.
- Do not abandon, restore, rebase, squash, or rewrite another agent's change
  without explicit ownership.
- Do not run `jj file track .` from the served root checkout.

If `jj` is unavailable, stop and escalate. This pack depends on JJ.
{{ end }}
