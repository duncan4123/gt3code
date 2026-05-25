---
name: jj
description: T3Code/GasCity-specific JJ workspace, Jorje review, and landing rules for the JJ agent pack.
allowed-tools: Bash(jj *), Bash(gc *), Bash(bd *)
---

# JJ Stack Skill

Use this skill in JJ-backed Gas City rigs, especially when working with
workspaces, stacks, Jorje reviews, or landing code.

## Required Checks

```bash
jj status
jj log -r 'ancestors(@, 8)' --no-pager
```

Before claiming a handoff is clean, also run:

```bash
jj status
```

## Agent Rules

- Worker agents create and edit only their bead workspace.
- Worker and agent workspaces must stay outside the served T3 checkout.
- Lander agents are the only agents that move pack target bookmarks.
- Pack targets land on `staging/current`; humans promote to `live/current`.
- Sentinel agents repair stuck state; they do not land code.
- Preserve `jj_change`, `jj_workspace`, and `work_dir` metadata on beads.
- Do not run `jj file track .` from the served root checkout.

## Common Commands

```bash
jj workspace add --name NAME -r REV -m MESSAGE PATH
jj workspace list
jj workspace root
jj workspace forget NAME
jj op log --limit 20
jj op undo OPERATION_ID
jj describe -m "message"
jj git push --remote jorje -c @
jj bookmark set staging/current -r CHANGE
jj git push --remote jorje --bookmark staging/current
jj bookmark set live/current -r staging/current
```
