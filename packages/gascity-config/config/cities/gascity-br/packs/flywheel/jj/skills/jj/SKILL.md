# Jujutsu Skill

Use this skill when working in a repository that has `.jj/`, when the task
mentions `jj`, Jujutsu, stacks, bookmarks, or Jorje, or when you need to keep
Git and JJ state synchronized.

## Core Checks

Run both status commands before claiming a repo is clean:

```bash
git status --short --branch
jj status
```

If you create commits with Git, run `jj status` afterward. In colocated repos,
that imports Git HEAD into JJ and resets the working-copy parent when needed.

## Common Commands

```bash
jj status                 # working-copy and parent state
jj log                    # stack / change graph
jj diff                   # current working-copy commit diff
jj new                    # start a new child change
jj describe               # edit current change description
jj squash                 # fold current change into parent
jj git fetch              # fetch Git remotes into JJ
jj git push --bookmark X  # push a Git-compatible bookmark/branch
jj git push -c @          # push current change for jj-native review
```

Use `git push <remote> <branch>` when the task explicitly asks for GitHub,
Codeberg, or another branch-based remote and the repository already has the
correct Git branch/bookmark.

## Stacks

A stack is a chain of small changes where each change builds on the previous
one. Prefer this shape for multi-part work:

```text
main
  -> data model
    -> API
      -> UI
        -> docs
```

Keep each change reviewable. If a child change depends on a parent, update the
parent in place and let JJ rebase descendants.

## Safety Rules

- Do not run destructive commands such as `jj abandon`, `jj restore`, or broad
  rebases unless the human explicitly asks.
- Do not rewrite or squash other agents' changes without ownership clarity.
- If Git and JJ disagree, inspect both diffs before editing or reporting clean
  state.
- If a remote rejects authentication, stop and report the exact remote and
  auth method rather than retrying with unrelated keys.
