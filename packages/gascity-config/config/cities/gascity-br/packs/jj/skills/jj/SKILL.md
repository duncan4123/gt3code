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
git status --short --branch
jj status
```

## Agent Rules

- Worker agents create and edit only their bead workspace.
- Lander agents are the only agents that move target bookmarks.
- Sentinel agents repair stuck state; they do not land code.
- Preserve `jj_change`, `jj_workspace`, and `work_dir` metadata on beads.

## Common Commands

```bash
jj workspace add --name NAME -r REV -m MESSAGE PATH
jj workspace list
jj workspace root
jj workspace forget NAME
jj describe -m "message"
jj git push --remote jorje -c @
jj bookmark set main -r CHANGE --allow-backwards
jj git push --remote origin --bookmark main
```
