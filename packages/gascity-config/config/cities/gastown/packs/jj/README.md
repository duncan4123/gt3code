# JJ Agent Pack

JJ-native multi-agent workflow for Gas City rigs.

The pack replaces branch/worktree handoff with JJ workspaces, change IDs, and
Jorje reviews:

- `planner` breaks broad work into stack-shaped beads.
- `worker` owns one bead, creates one JJ workspace/change, and submits it.
- `lander` is the single writer that lands approved changes to the target bookmark.
- `sentinel` watches stale workspaces, stuck reviews, and dead sessions.

Gas City and Doltlite-backed `bd` beads remain the queue and ownership system.
JJ is the code-change system. Jorje is the review surface.

Agent state and bead workspaces live inside the T3 install's shared worktree
root by default:

```text
${T3CODE_WORKTREES_DIR:-$T3CODE_HOME/worktrees}/gascity/<city>/<rig>/jj/
```

Set `GC_JJ_WORKSPACES_ROOT` to override the bead workspace root.

## Metadata Contract

- `work_dir`: absolute JJ workspace path for the bead.
- `jj_workspace`: JJ workspace name.
- `jj_change`: submitted JJ change ID.
- `jj_parent`: parent/base revision used for the workspace.
- `target`: target bookmark, usually `integration/t3code-agent-controls-sidebar`.
- `target_remote`: remote that owns the target bookmark, usually `jorje`.
- `jorje_review`: optional Jorje review URL or pushed review ref.
- `rejection_reason`: lander/sentinel reason for returning work to the pool.

## Usage

Add the pack to a rig:

```toml
[[rigs]]
name = "t3-jj"
prefix = "tj"
includes = ["packs/jj"]
```
