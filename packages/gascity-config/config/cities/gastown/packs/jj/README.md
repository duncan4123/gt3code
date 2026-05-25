# JJ Agent Pack

JJ-native multi-agent workflow for Gas City rigs.

The pack replaces branch/worktree handoff with JJ workspaces, change IDs, and
Jorje reviews:

- `planner` breaks broad work into stack-shaped beads.
- `worker` owns one bead, creates one JJ workspace/change, runs only focused
  checks when requested, and submits it to sentinel.
- `sentinel` watches stale workspaces, stuck reviews, dead sessions, and
  submitted-change readiness. It does not run builds or complete test suites.
- `lander` is the single writer that lands approved changes to `staging/current`.
  It is the only role allowed to run builds or complete test suites.

Gas City and Doltlite-backed `bd` beads remain the queue and ownership system.
JJ is the code-change system. Jorje is the review surface.

The pack ships shared skills under `skills/`, including:

- `jj`: T3Code/GasCity-specific JJ workspace and landing rules.
- `jujutsu`: general Jujutsu VCS safety and command workflow guidance, adapted
  from `danverbraganza/jujutsu-skill`.

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
- `target`: target bookmark, usually `staging/current`.
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

## T3Code Live Workflow

`staging/current` is the pack landing target. `live/current` is the human
promotion target and the only bookmark the runnable live workspace should edit.

```text
worker workspaces -> sentinel-approved JJ changes -> staging/current -> live/current
```

The pack must create agent workspaces under the install/control tree, not in
the live checkout:

```text
${T3CODE_WORKTREES_DIR:-$T3CODE_HOME/worktrees}/gascity/<city>/<rig>/jj/
```
