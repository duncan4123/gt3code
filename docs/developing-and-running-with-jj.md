# Developing And Running With JJ

T3Code uses JJ workspaces to separate the app we run from the work agents are
creating. The goal is simple: the running app stays clean, agent work remains
recoverable, and promotion to live is explicit.

## Directory Model

```text
/data/projects/t3code
  Install/control workspace.
  Owns persistent runtime state in .t3-dev.

/data/projects/t3code-live
  Clean runnable JJ workspace.
  Edits the live/current bookmark.

/data/projects/t3code/.t3-dev
  Runtime state, logs, app databases, Gas City home, and agent workspaces.
```

Do not put agent workspaces under `/data/projects/t3code-live`. That checkout
is for running the app.

## Runtime State

The live runner sets runtime state to the install/control tree:

```text
T3CODE_HOME=/data/projects/t3code/.t3-dev
T3_HOME=/data/projects/t3code/.t3-dev
T3CODE_WORKTREES_DIR=/data/projects/t3code/.t3-dev/worktrees
GC_WORKTREES_DIR=/data/projects/t3code/.t3-dev/worktrees
T3CODE_GASCITY_HOME=/data/projects/t3code/.t3-dev/gascity
GC_HOME=/data/projects/t3code/.t3-dev/gascity
```

This keeps state stable even when the live workspace is recreated or rebased.

## Bookmarks

`live/current` is the runnable app state. `/data/projects/t3code-live` should
edit this bookmark and stay clean.

`staging/current` is the JJ pack landing target. Lander agents may move this
bookmark after validating submitted worker changes.

`push-*` and `gc-*` bookmarks are candidate or agent-produced work. They are
not the app we run.

`checkpoint/*` bookmarks are recovery anchors. Do not use them as active
development targets.

## Agent Flow

```text
worker workspace
  -> submitted JJ change
  -> lander validates and lands to staging/current
  -> human reviews staging/current
  -> human promotes to live/current
  -> /data/projects/t3code-live runs live/current
```

Workers create one JJ workspace per bead under:

```text
${T3CODE_WORKTREES_DIR}/gascity/<city>/<rig>/jj/workspaces/
```

This path should resolve inside the persistent install/control state tree, not
inside `/data/projects/t3code-live`.

Workers record at least:

```text
work_dir
jj_workspace
jj_change
jj_parent
target
target_remote
```

## Running The App

Run from the live workspace:

```bash
/data/projects/t3code-live/scripts/run-live.sh
```

The runner prints the code path, state path, worktree root, server port, and web
port. The app should be run from `live/current`, not from an agent workspace.

## Promotion

Review staging first:

```bash
jj status
jj log -r 'staging/current::live/current | live/current::staging/current'
jj diff --from live/current --to staging/current
```

Promote when staging is accepted:

```bash
jj bookmark set live/current -r staging/current
jj workspace update-stale
```

Then restart the live runner from `/data/projects/t3code-live`.

## Recovery

Use `jj op log` to find recent operations and `jj op undo` to reverse a bad
operation.

Use `checkpoint/*` bookmarks to compare or restore known states. Before risky
history work, create a checkpoint:

```bash
jj bookmark set checkpoint/<name>-$(date +%Y%m%d%H%M%S) -r live/current
```

Never abandon another agent's change unless the bead metadata and owner make it
clear the work is obsolete.
