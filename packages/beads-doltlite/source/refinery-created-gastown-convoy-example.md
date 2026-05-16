# Refinery-Created Gastown Convoy Example

Purpose: show a convoy + child bead shape that works when Gastown routes work to a refinery but the real code lives in a specific repo clone.

Created example beads:

- Epic: `bd-c8a`
- Child handoff bead: `bd-c8a.1`

## What was created

### Convoy epic: `bd-c8a`

- Title: `Example Gastown convoy with explicit repo target`
- Type: `epic`
- Labels: `convoy`, `example`, `gastown`
- Metadata:
  - `convoy.example=true`
  - `repo.name=repo-beads`
  - `repo.path=/home/ubuntu/.local/state/t3code/gascity/current/city/.gc/worktrees/beads-doltlite/polecats/slit/repo-beads`
  - `repo.remote=origin`
  - `target=main`
  - `gc.routed_to=beads-doltlite/polecat`

### Refinery child bead: `bd-c8a.1`

- Title: `Example refinery handoff for explicit repo branch`
- Type: `task`
- Assignee: `beads-doltlite/refinery`
- Labels: `convoy`, `example`, `gastown`
- Parent: `bd-c8a`
- Metadata:
  - `convoy.example=true`
  - `repo.name=repo-beads`
  - `repo.path=/home/ubuntu/.local/state/t3code/gascity/current/city/.gc/worktrees/beads-doltlite/polecats/slit/repo-beads`
  - `repo.remote=origin`
  - `branch=slit/t3-muxt4`
  - `target=main`
  - `merge_strategy=direct`
  - `gc.routed_to=beads-doltlite/refinery`

## Why this setup is different

Old handoff shape only had branch metadata, for example:

- `branch=polecat/bd-git-3`
- `target=main`

That breaks when rig state and git refs do not live in same repo root. Refinery can read bead state, then run git commands in wrong repo and get false negatives.

This example fixes contract by making repo target explicit:

- `repo.path` tells refinery which `.git` owns branch
- `repo.name` gives stable human-readable repo id
- `repo.remote` tells refinery which remote name to use for fetch/push
- `branch` stays merge source
- `target` stays merge destination

## Recommended refinery contract

For any refinery-routed child bead, require:

- `repo.path`
- `repo.name`
- `repo.remote`
- `branch`
- `target`
- `gc.routed_to`

Optional but useful:

- `merge_strategy`
- `convoy.example` or another workflow marker
- workflow-specific origin metadata such as `audit.origin`

## Example creation commands

```bash
bd create \
  --type epic \
  --title "Example Gastown convoy with explicit repo target" \
  --description "Reference convoy showing the metadata contract needed when Gastown work is handed to a refinery for a nested code repo." \
  --labels convoy,gastown,example \
  --metadata '{"convoy.example":"true","repo.name":"repo-beads","repo.path":"/home/ubuntu/.local/state/t3code/gascity/current/city/.gc/worktrees/beads-doltlite/polecats/slit/repo-beads","repo.remote":"origin","target":"main","gc.routed_to":"beads-doltlite/polecat"}'

bd create \
  --type task \
  --parent bd-c8a \
  --title "Example refinery handoff for explicit repo branch" \
  --description "Reference child bead showing the metadata needed for a refinery to merge work from the real code repo instead of a wrapper rig repo." \
  --assignee "beads-doltlite/refinery" \
  --labels convoy,gastown,example \
  --metadata '{"convoy.example":"true","repo.name":"repo-beads","repo.path":"/home/ubuntu/.local/state/t3code/gascity/current/city/.gc/worktrees/beads-doltlite/polecats/slit/repo-beads","repo.remote":"origin","branch":"slit/t3-muxt4","target":"main","merge_strategy":"direct","gc.routed_to":"beads-doltlite/refinery"}'
```

## Operational note

This document only fixes metadata contract. If refinery shell still starts in a wrapper repo or city root, formula code must still `cd "$repo.path"` before any git fetch, branch lookup, rebase, merge, or push.
