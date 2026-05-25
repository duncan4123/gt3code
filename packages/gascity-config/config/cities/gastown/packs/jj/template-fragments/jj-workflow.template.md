{{ define "jj-workflow" }}

## JJ Stack Workflow

This rig uses JJ for code changes. Gas City/beads track ownership and lifecycle.
JJ tracks code state. Jorje is the review surface.

- Pack landing target: `staging/current@jorje`.
- Runnable app target: `live/current`.
- Workers and landers never edit `live/current`; a human promotes reviewed
  staging work to live.
- The served `/data/projects/t3code` checkout must be a clean empty child of
  `live/current`. Never run the app from `staging/current`, a worker change, or
  a dirty workspace.
- Treat `jj_change` as the durable code-change ID.
- Treat `work_dir` as the active JJ workspace for a bead.
- Use one JJ workspace per active code-writing bead.
- Keep agent state and bead workspaces under `.t3-dev/worktrees/gascity/...`,
  inside the T3 install's shared worktree root but outside the served source tree.
- Workers submit changes; only the lander moves target bookmarks.
- Prefer stacked changes over broad mixed changes.
- Check `jj status` before handoff.
- Do not abandon, restore, rebase, squash, or rewrite another agent's change
  without explicit ownership.
- Do not run `jj file track .` from the served root checkout.
- Do not run `jj new staging/current` in the served root checkout. Use separate
  JJ workspaces for staging or worker work.

## Upstream And History Discipline

The current work is a T3 Code + Gas City + Doltlite Beads integration. Keep code
easy to rebase against upstream T3 Code, upstream Gas City, and upstream Beads.

- Prefer new fork-owned bridge files, adapters, config, and template fragments
  over invasive edits to upstream-owned source.
- If a feature appears missing, search older JJ changes, bookmarks, sibling
  workspaces, and commits before rebuilding it. A working implementation often
  already exists in history.
- When porting recovered code, keep the smallest maintainable slice and record
  which layer owns it: T3 Code UI/server, Gas City orchestration, Beads/Doltlite
  storage, or bridge glue.
- Avoid mixing upstream alignment work with product behavior changes in the same
  JJ change unless the bead explicitly requires it.

If `jj` is unavailable, stop and escalate. This pack depends on JJ.
{{ end }}
