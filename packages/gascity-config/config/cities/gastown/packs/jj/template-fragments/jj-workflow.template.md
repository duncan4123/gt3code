{{ define "jj-workflow" }}

## JJ Stack Workflow

This rig uses JJ for code changes. Gas City/beads track ownership and lifecycle.
JJ tracks code state. Jorje is the review surface.

- Default trunk: `integration/t3code-agent-controls-sidebar@jorje`.
- Treat `jj_change` as the durable code-change ID.
- Treat `work_dir` as the active JJ workspace for a bead.
- Use one JJ workspace per active code-writing bead.
- Keep agent state and bead workspaces under `{{.WorktreesRoot}}/gascity/...`,
  inside the T3 install's shared worktree root but outside the served source tree.
- Workers submit changes; only the lander moves target bookmarks.
- Prefer stacked changes over broad mixed changes.
- Check `jj status` before handoff. If Git was used, run `jj status` again so
  JJ imports the colocated Git state.
- Do not abandon, restore, rebase, squash, or rewrite another agent's change
  without explicit ownership.
- Do not run `jj file track .` from the served root checkout.

If `jj` is unavailable, stop and escalate. This pack depends on JJ.
{{ end }}
