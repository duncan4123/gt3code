# HQ Polecat `.codex` Collision Audit

Date: 2026-05-06
Bead: `t3-arx.3`

## Summary

HQ polecat worktree startup currently converts the tracked repository path `.codex`
from a regular file into a runtime-managed directory. Git then reports the tracked
file as deleted:

```text
 D .codex
```

This is not a user edit. It is a deterministic startup side effect.

## What happened

1. The repository tracks `.codex` as an empty regular file.
2. HQ polecat startup materializes Codex runtime assets under `.codex/`.
3. The worktree ends up with `.codex/skills/...` present.
4. Git sees the tracked file missing and reports `.codex` as deleted.

Observed state in this worktree:

- `git ls-tree HEAD .codex` shows `.codex` as a tracked blob.
- `find .codex -maxdepth 2` shows runtime materialized skills under `.codex/skills/`.
- `git diff -- .codex` shows deletion of the tracked file.

## Relevant codepaths

- `packages/gascity/source/internal/materialize/skills.go`
  - Codex skill sink is `.codex/skills`.
- `packages/gascity/source/internal/materialize/mcp_project.go`
  - Codex MCP projection target is `.codex/config.toml`.
- `packages/gascity/source/internal/overlay/merge.go`
  - Codex hook merge target is `.codex/hooks.json`.
- `packages/gascity-config/config/packs/gastown/scripts/worktree-setup.sh`
  - Local git excludes intentionally ignore `.codex/` as runtime infrastructure.

## Root cause

The repository path and the runtime-managed path use the same top-level name with
different filesystem types:

- Repo expectation: `.codex` is a regular file.
- Runtime expectation: `.codex` is a directory tree.

Those states cannot coexist in one worktree.

## Impact

- Every Codex worktree can appear dirty immediately after startup.
- Dirty state hides real user edits in `git status`.
- Automation that assumes a clean worktree after bootstrap becomes unreliable.

## Fix options

1. Stop tracking `.codex` as a regular file.
2. If a placeholder is required, replace it with a directory-safe sentinel such as
   `.codex/.gitkeep`, but only if runtime ownership rules still make sense.
3. Prefer no tracked repo content under `.codex` if the path is fully runtime-managed.

## Recommendation

Treat `.codex` as runtime-owned infrastructure and remove the tracked file from the
repository. That matches current materialization behavior for skills, MCP config,
and hooks.
