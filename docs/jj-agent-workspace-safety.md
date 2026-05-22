# JJ Agent Workspace Safety

## Runtime Checkout

Start the live T3 dev app with:

```bash
/data/projects/t3code/scripts/run-live.sh
```

The launcher runs code from `/data/projects/t3code-live`, but keeps persistent
state in `/data/projects/t3code/.t3-dev`. Do not assign agents to the live
checkout.

The important split is:

```text
/data/projects/t3code       install/control checkout and persistent state
/data/projects/t3code-live  clean runtime code checkout
```

If running manually, preserve the same state path:

```bash
cd /data/projects/t3code-live
T3CODE_HOME=/data/projects/t3code/.t3-dev \
T3_HOME=/data/projects/t3code/.t3-dev \
T3CODE_WORKTREES_DIR=/data/projects/t3code/.t3-dev/worktrees \
T3CODE_GASCITY_HOME=/data/projects/t3code/.t3-dev/gascity \
GC_HOME=/data/projects/t3code/.t3-dev/gascity \
bun dev
```

## Agent Workspace Root

JJ pack agents and bead workspaces use:

```bash
${T3CODE_WORKTREES_DIR:-$T3CODE_HOME/worktrees}/gascity/<city>/<rig>/jj/
```

T3Code sets `T3CODE_HOME`, `T3CODE_WORKTREES_DIR`, and `GC_WORKTREES_DIR` at
runtime. Override bead workspaces with `GC_JJ_WORKSPACES_ROOT` when needed.

## Recovery

Before risky work, save an out-of-repo patch:

```bash
mkdir -p "${T3CODE_HOME:?T3CODE_HOME required}/worktrees/recovery"
git diff --binary > "$T3CODE_HOME/worktrees/recovery/default-worktree-$(date +%Y%m%dT%H%M%S).patch"
```

Inspect JJ operations:

```bash
jj op log --limit 20
```

Undo a bad JJ operation:

```bash
jj op undo <operation-id>
```

Restore one file from a change:

```bash
jj restore --from <change-id> -- path/to/file
```

## Rules

- Do not run `jj file track .` from the served root checkout.
- Keep `.jj-workspaces/`, `.gc/`, and `.dolt/` out of tracked source changes.
- Lander moves target bookmarks; workers only edit their own bead workspace.
