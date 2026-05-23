---
title: T3code Upstream JJ Workflow
description: Repeatable jj-first workflow for auditing and updating the t3code Gas City fork from upstream Gas City without losing fork features.
---

## Current Audit Baseline

Snapshot taken on 2026-05-21 from `integrate/t3code-full`.

- Current branch tip: `45123fec0914`
- Fetched upstream target: `upstream/main` at `e81a179c993d`
- Merge base: `127ad771134c`
- Divergence: upstream ahead 51 commits, t3code ahead 9 commits
- Incoming scope: 1465 files changed, 213923 insertions, 45553 deletions

Primary incoming risk bands:

- `cmd/gc/`: CLI, lifecycle, beads provider, convoy, doctor, dispatch, mail, events, and generated command behavior
- `internal/api/`, `internal/events/`, `internal/extmsg/`: typed API and event surface
- `cmd/gc/dashboard/web/`, `docs/schema/`: generated dashboard/API contracts
- `examples/`, `docs/`, `engdocs/`: formulas, pack behavior, and contributor process
- `.github/`, `.githooks/`, `Makefile`, dependency files: CI and local quality gates

Fork features to preserve:

- t3bridge provider and session thread reuse behavior
- t3code package source overlay and Codex package hooks
- local Gas City runtime fixes already merged into `integrate/t3code-full`
- fork-specific city/package configuration behavior

Initial fork feature ledger:

| Feature | Known files / references | Audit focus |
| --- | --- | --- |
| Native T3 bridge provider | `internal/runtime/t3bridge/`, `engdocs/contributors/t3-session-bridge-history-summary.md` | provider startup envelope, native auth, thread reuse, T3 unreachable behavior |
| T3 bridge CLI/status plumbing | `cmd/gc/agent_build_params.go`, `cmd/gc/template_resolve.go`, `cmd/gc/session_beads.go`, `cmd/gc/api_state.go` | upstream lifecycle/session changes must not bypass t3bridge behavior |
| t3code worktree placement | `internal/workdir/workdir.go`, `internal/workdir/workdir_test.go` | preserve `T3CODE_WORKTREES_DIR` override semantics |
| t3code package source sync | `sync/t3code-package-source`, `origin/sync/t3code-package-source` | keep package overlay source and Codex hook additions distinct from upstream |
| Local runtime fixes | `integrate/t3code-full` commits ahead of upstream | classify each ahead commit before rebasing or replacing with upstream equivalent |

## Convoy Shape

Use one parent convoy bead for each upstream refresh and child beads for bounded audit lanes. Each child records:

- upstream commit/range reviewed
- fork feature risk
- conflict files, if any
- required validation gates
- final decision: adopt, adapt, defer, or reject

Recommended lanes:

- Workflow and branch mechanics
- Fork feature ledger
- CLI/runtime audit
- API/event/dashboard audit
- Config/examples/docs audit
- CI/dependency audit
- Trial integration and validation

## JJ Workflow

### 1. Refresh and import refs

```bash
git fetch upstream main
git fetch origin
jj git import
```

Use Git remote-tracking refs for the source of truth and jj revsets for local inspection. If a remote ref is not visible as a jj bookmark, reference it through Git for raw comparisons and create a local jj bookmark only after deciding to integrate.

### 2. Capture immutable anchors

```bash
BRANCH=$(git branch --show-current)
TARGET=upstream/main
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE=$(git merge-base HEAD "$TARGET")

git branch "safety/${BRANCH##*/}-${STAMP}" HEAD
jj bookmark create "audit/${BRANCH##*/}-${STAMP}" -r @-
```

The safety branch is the recovery anchor. The jj bookmark points at the parent of the empty working-copy changeset, matching Git `HEAD`.

### 3. Audit before integration

```bash
git rev-list --left-right --count HEAD..."$TARGET"
git diff --shortstat HEAD.."$TARGET"
git diff --dirstat=files,0 HEAD.."$TARGET"
git log --oneline --no-merges HEAD.."$TARGET"
git log --oneline --no-merges "$TARGET"..HEAD
```

Create or update convoy child beads from this output before touching the branch. The goal is to know where fork features overlap upstream before merge conflicts force rushed choices.

### 4. Create a jj trial branch

```bash
jj new @
jj describe -m "trial: integrate upstream/main into ${BRANCH}"
jj bookmark create "trial/upstream-${STAMP}" -r @
git merge --no-ff "$TARGET"
jj git import
```

Resolve conflicts in the trial changeset. Do not move the production bookmark until the convoy audit accepts the result.

### 5. Preserve fork behavior explicitly

For every conflict, classify the resolution:

- upstream-only: fork has no local behavior to keep
- fork-only: preserve t3code behavior and note why upstream does not replace it
- combined: keep both paths behind existing config/provider boundaries
- deferred: leave a child bead with exact file and reason

Never preserve fork behavior by accident. Each fork-specific resolution needs an explicit note on the relevant child bead.

### 6. Validate only after audit owner asks

Build and test commands stay out of the workflow until the owner requests validation. When requested, use the project gates from `TESTING.md` and dashboard/API gates for touched API or dashboard surfaces.

### 7. Land after convoy closeout

```bash
jj bookmark set "$BRANCH" -r "trial/upstream-${STAMP}"
jj git export
git status --short --branch
git push origin "$BRANCH"
```

Keep `safety/...` until the pushed branch has been verified in the running city.

## Recovery

Use recovery paths in this order:

1. `jj op log` then `jj op restore <operation>` for jj-local mistakes
2. `git switch safety/<branch>-<stamp>` for branch recovery
3. `git merge --abort` if the trial merge is still in progress
4. abandon the trial changeset and recreate it from the audit bookmark

Do not rewrite or delete the current production bookmark until the convoy child beads are closed.
