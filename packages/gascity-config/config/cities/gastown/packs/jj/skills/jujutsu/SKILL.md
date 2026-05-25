---
name: jujutsu
description: "Required for Jujutsu (jj) version-control work. Use before status, log, diff, workspace, bookmark, rebase, squash, restore, push, or any VCS operation in a jj repo."
allowed-tools: Bash(jj *)
---

# Jujutsu (jj) Version Control System

Adapted from <https://github.com/danverbraganza/jujutsu-skill/blob/main/jujutsu/SKILL.md>.
Original skill license: MIT License, Copyright (c) 2026 jujutsu-skill contributors.

This skill helps agents work with Jujutsu, a Git-compatible VCS with mutable
commits, automatic rebasing, and a working copy that is itself a commit.

Tested upstream with `jj v0.37.0`. Commands may differ in other versions.

## Agent Environment Rules

Always provide messages inline with `-m` instead of relying on an editor:

```bash
jj desc -m "message"
jj squash -m "message"
```

Do not run editor-based forms such as bare `jj desc`, bare `jj squash`,
`jj squash -i`, `jj split`, or `jj resolve`; those can hang non-interactive
agent sessions. Resolve conflicts by editing files directly and checking
`jj st`.

After any mutation, verify with:

```bash
jj st
```

## Core Concepts

The working directory is always a commit, referenced as `@`. There is no
staging area, and there is no need to run `jj commit`; changes are snapshotted
when jj observes the working copy.

Commits are mutable. You can edit descriptions, squash, absorb, rebase, and
restore without creating extra throwaway commits.

Use change IDs when referring to work across rewrites. Change IDs remain stable
when commit IDs change.

Useful revsets:

- `@`: working-copy commit.
- `@-`: parent of the working-copy commit.
- `::@`: ancestors of `@`.
- `@::`: descendants of `@`.
- `trunk()..@`: commits between trunk and `@`.
- `bookmarks()`: bookmarked commits.

## Describe-First Workflow

Before editing, make sure the current change has a clear description:

```bash
jj st
jj new -m "Fix provider restart on stale session binding"
```

If you are already on the intended empty change, describe it instead:

```bash
jj desc -m "Fix provider restart on stale session binding"
```

Keep each commit to one logical change. Refine before handing work off.

## Viewing Work

Use unified diff format unless a task specifically needs jj's native view:

```bash
jj st
jj log
jj show
jj diff --git
```

Default `jj diff` output is valid, but it uses jj's native format and can be
confused with stale or corrupt content. Prefer `jj diff --git` for review.

## Moving Around

```bash
jj new -m "Message"
jj edit CHANGE_ID
jj prev -e
jj next -e
```

## Refining Commits

Move current changes into the parent:

```bash
jj squash -m "Message"
```

Automatically distribute working-copy changes into the commits that last
modified those lines:

```bash
jj absorb
```

Abandon a commit and rebase descendants onto its parent:

```bash
jj abandon CHANGE_ID
```

Undo the previous jj operation:

```bash
jj undo
```

Restore files from another revision or from the parent:

```bash
jj restore path/to/file.txt
jj restore --from CHANGE_ID path/to/file.txt
```

## Rebasing

```bash
jj rebase -d DEST
jj rebase -r CHANGE_ID -d DEST
jj rebase -s CHANGE_ID -d DEST
```

Use `-s` when moving a stack with descendants.

## Bookmarks

Bookmarks are jj's branch-like refs. They do not automatically follow new
commits.

```bash
jj bookmark list
jj bookmark create NAME -r @
jj bookmark move NAME --to CHANGE_ID
jj git push -b NAME
```

Before pushing, verify that the bookmark points at the intended change.

## Git Interop

If `.jj/` exists, prefer jj commands. In a non-colocated jj repo, raw git
commands can corrupt state. In a colocated repo, use git only when the workflow
requires it and return to jj with `jj edit`.

Fetch remotes with jj:

```bash
jj git fetch
jj git fetch --remote REMOTE
jj git fetch -b BRANCH
```

## Quality Bar

Before handing off:

```bash
jj st
jj diff --git
```

Check that the change is atomic, the description is clear, and unrelated files
are not mixed into the same commit.
