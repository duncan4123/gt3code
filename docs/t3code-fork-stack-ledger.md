# T3Code Fork Stack Ledger

This ledger tracks the fork-owned changes that should be replayed when rebasing
T3Code onto `upstream/main`.

Last checked upstream:

- `upstream/main`: `d1e85c4e8fdef82fbaded9539532b754080419e0`
- upstream commit date: `2026-05-15T06:40:13+00:00`
- upstream-existing files modified by this fork: `196`

The durable identifiers below are JJ change IDs. Git commit IDs can change every
time the stack is rewritten.

## Current Stack

Oldest fork layer first:

| Stack                | Change ID  | Commit         | Description                                                           |
| -------------------- | ---------- | -------------- | --------------------------------------------------------------------- |
| Local bead metadata  | `ymnsqwum` | `edd57311f780` | `chore(beads): preserve local bead metadata`                          |
| Contracts/support    | `trktnprq` | `5a84258b0710` | `feat(contracts): add upstream editor and settings surfaces`          |
| VCS/JJ support       | `zwursvzt` | `a2c8f64b7bd0` | `feat(vcs): preserve git and jj source-control support`               |
| Doltlite/checkpoints | `wmozslnr` | `7087d691f6f0` | `feat(doltlite): preserve persistence and checkpoint backend support` |
| T3 bridge/runtime    | `nruplplw` | `927696c45e8b` | `feat(t3bridge): preserve provider orchestration runtime`             |
| Left sidebar         | `yrpnppny` | `deb2b0c30b6c` | `feat(sidebar): preserve left navigation and project grouping`        |
| Right sidebar/chat   | `vwzqnnns` | `105d5b70dc44` | `feat(chat): preserve right sidebar and session workflow`             |
| Gas City/JJ pack     | `kzurswrl` | `84bfa7fb3096` | `chore(gascity-config): format configs and enable t3code jj pack`     |
| Ledger               | `wpzzmmlz` | `488303f0fb90` | `docs: add t3code fork stack ledger`                                  |

`ymnsqwum` is intentionally separate because it currently contains only
`.beads/metadata.json`. Product rebases should start at `trktnprq` unless bead
metadata also needs to move.

The current top cleanup/support layers are:

| Stack                | Change ID  | Description                                      |
| -------------------- | ---------- | ------------------------------------------------ |
| Marketing removal    | `vwuroyzr` | `chore(marketing): remove unused marketing app`  |
| Validation stability | `owqwrllu` | `test: stabilize validation under monorepo load` |

These are not core product features, but they are deliberate fork-owned layers.

## Conflict Model

This ledger is for making upstream rebases easy, so it focuses on files that can
actually conflict with upstream.

The important surfaces are:

- upstream-existing files modified by the fork
- fork-created support files imported or referenced by those modified files
- root/package/build wiring that connects fork-only packages to T3Code

Fork-only package payloads are not conflict surfaces unless upstream later adds
the same paths. These package trees should ride along as coarse payload stacks:

- `packages/doltlite/**`
- `packages/gascity/**`
- `packages/beads-doltlite/**`
- `packages/doltlite-client/**`
- `packages/gascity-config/**`

Do not spend rebase effort auditing those trees file-by-file. Rebase attention
belongs on their app-facing integration points: `package.json`, `bun.lock`,
`turbo.json`, `apps/server/package.json`, `apps/server/src/persistence/**`,
`apps/server/src/gc/**`, `scripts/**`, and the web/sidebar files that display
GC state.

## Conflict-Surface Accounting

The compact product stack currently accounts for these conflict-prone layers:

| Layer                | Change ID  | Upstream-overlap files                                             | Fork-only support files                                            |
| -------------------- | ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Local bead metadata  | `ymnsqwum` | `.beads/metadata.json`                                             | none                                                               |
| Contracts/support    | `trktnprq` | contracts/shared schema and package wiring                         | none                                                               |
| VCS/JJ support       | `zwursvzt` | Git, JJ, VCS, source-control server files                          | JJ/VCS support files are carried in the same layer                 |
| Doltlite/checkpoints | `wmozslnr` | checkpointing, persistence touchpoints, desktop persistence test   | `apps/server/scripts/patch-doltlite.mjs`                           |
| T3 bridge/runtime    | `nruplplw` | provider, orchestration, GC, project, workspace, server/ws runtime | generated GC API/client support files stay with this layer         |
| Left sidebar         | `yrpnppny` | sidebar logic and project grouping                                 | `SidebarGcFolders` support files stay with this layer              |
| Right sidebar/chat   | `vwzqnnns` | `ChatView`, branch/diff/PR/chat workflow files                     | `chat-scroll.ts`, `SkillInlineText.tsx`, `archivedThreadsState.ts` |
| Gas City/JJ pack     | `kzurswrl` | bundled config package tests and city config                       | JJ pack/config files in `packages/gascity-config/**`               |
| Marketing removal    | `vwuroyzr` | root workspace/lock/release fixture wiring                         | deleted fork-only marketing app payload                            |
| Validation stability | `owqwrllu` | test/type wrapper fixes needed by gates                            | none                                                               |

Anything outside those categories should be treated as either:

- fork-only package payload with no expected upstream conflict, or
- local/runtime state that should not be part of the portable product stack.

## Remaining Audit Buckets

The 196 upstream-existing modified files are not all product-feature files.
These additional buckets should be kept explicit so future rebases do not
misclassify them as accidental drift:

| Bucket                         | Approx. files | Belongs with                        | Notes                                                                 |
| ------------------------------ | ------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Auth/environment bootstrap     | 2-10          | T3 bridge/runtime                   | `authBootstrap`, environment auth/target, local API, RPC client glue  |
| Web shell/composer/settings    | 30-35         | Left sidebar or right sidebar/chat  | command palette, composer editor, settings panels, UI primitives      |
| Server startup/environment     | 4             | T3 bridge/runtime                   | server startup, server environment layer, analytics service           |
| Desktop runtime support        | 3-4           | Doltlite/checkpoints or T3 bridge   | backend readiness, desktop package/build config, client persistence   |
| Client runtime/remote packages | 5-7           | T3 bridge/runtime                   | `client-runtime`, SSH, Tailscale, app-server package integration      |
| Root/build/release wiring      | 15-20         | Build/release support               | workspace manifests, lockfile, turbo/vitest, workflows, release smoke |
| Validation stability           | 3             | Validation stability                | test timeout and type fixes required for gates                        |
| Local/runtime artifacts        | varies        | Usually exclude from portable stack | `.beads.backup-*`, `.backups`, runtime-generated local state          |

The important follow-up is to decide whether each bucket should remain a
support layer or be folded into the nearest product stack. The rebase-critical
part is that each file has an intended owner before replaying onto a new
`upstream/main`.

## Feature Stacks

### Contracts And Support

Change: `trktnprq`

Purpose:

- Preserve contract/schema additions required by fork UI and runtime layers.
- Keep editor, settings, RPC, provider, orchestration, IPC, and package export
  surfaces aligned with the app.

Key paths:

- `packages/contracts/src/**`
- `packages/shared/package.json`
- package manifests and build/test config touched by fork features

### VCS And JJ Support

Change: `zwursvzt`

Purpose:

- Preserve Git and JJ backends behind the app's source-control abstractions.
- Keep source-control discovery, repository services, VCS drivers, and shared
  Git utilities available after upstream merges.

Key paths:

- `apps/server/src/git/**`
- `apps/server/src/jj/**`
- `apps/server/src/vcs/**`
- `apps/server/src/sourceControl/**`
- `packages/contracts/src/git.ts`
- `packages/contracts/src/vcs.ts`
- `packages/shared/src/git.ts`

### Doltlite And Checkpoint Backend

Change: `wmozslnr`

Purpose:

- Preserve the fork persistence backend and checkpointing behavior.
- Keep Doltlite patching, sqlite compatibility layers, migrations, and desktop
  client persistence tests together.

Key paths:

- `apps/server/src/persistence/**`
- `apps/server/src/checkpointing/**`
- `apps/server/scripts/patch-doltlite.mjs`
- `apps/desktop/src/clientPersistence.test.ts`

### T3 Bridge Runtime

Change: `nruplplw`

Purpose:

- Preserve provider orchestration, provider runtime ingestion, WebSocket routing,
  GC integration, text generation, project setup, and workspace runtime support.

Key paths:

- `apps/server/src/orchestration/**`
- `apps/server/src/provider/**`
- `apps/server/src/gc/**`
- `apps/server/src/project/**`
- `apps/server/src/textGeneration/**`
- `apps/server/src/workspace/**`
- `apps/server/src/server.ts`
- `apps/server/src/ws.ts`

### Left Sidebar And Project Grouping

Change: `yrpnppny`

Purpose:

- Preserve fork navigation, project grouping, GC folder display, sidebar state,
  and settings-panel pieces directly tied to navigation.

Key paths:

- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/Sidebar.logic.ts`
- `apps/web/src/components/SidebarGcFolders.tsx`
- `apps/web/src/logicalProject.ts`
- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/components/settings/**`

### Right Sidebar, Chat, And Session Workflow

Change: `vwzqnnns`

Purpose:

- Preserve chat timeline behavior, composer/session workflow, branch controls,
  diff and PR UI, archived thread state, and thread action hooks.

Key paths:

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/chat/**`
- `apps/web/src/components/GitActionsControl.tsx`
- `apps/web/src/components/BranchToolbarBranchSelector.tsx`
- `apps/web/src/components/DiffPanel.tsx`
- `apps/web/src/components/PullRequestThreadDialog.tsx`
- `apps/web/src/hooks/**`
- `apps/web/src/lib/archivedThreadsState.ts`

### Gas City Config And JJ Pack

Change: `kzurswrl`

Purpose:

- Preserve bundled Gas City config, Gastown/T3Code rig wiring, and JJ workflow
  pack enablement.

Key paths:

- `packages/gascity-config/config/**`
- `packages/gascity-config/src/index.test.ts`

## Rebase Procedure

Use a dedicated JJ workspace for trial rebases:

```bash
jj workspace add .gc/jj/workspaces/t3-upstream-rebase-trial -r @
cd .gc/jj/workspaces/t3-upstream-rebase-trial
jj git fetch --remote upstream
jj rebase -s trktnprq -d upstream/main
```

If local bead metadata should also move with the product stack, rebase from
`ymnsqwum` instead of `trktnprq`.

After resolving conflicts:

```bash
bun fmt
bun lint
bun typecheck
```

Conflict rule of thumb: avoid wholesale "ours" or "theirs" resolution in
`ChatView.tsx`, `Sidebar.tsx`, provider/orchestration files, persistence files,
or VCS/JJ files. Those are the fork's primary feature surfaces.
