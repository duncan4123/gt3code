# T3 Sidebar — Gas City Integration Design

## Context

Convoy `t3-50e` implemented the foundation: `customMetadata` on threads, GC badges in sidebar, lifecycle state pills (drained/stopped), thread reuse on restart, and gc.* metadata propagation from gc-session-t3.

This document explores deeper integration of beads, formulas, and GC CLI commands into T3's existing UI surfaces.

## 1. Diff Panel / Git Sidebar — Bead Context

T3 already has BranchToolbar, GitActionsControl, DiffPanelShell, and turn diffs.

**Bead info banner in the diff panel.** When a thread has `gc.bead` metadata, show a collapsible banner at the top of the diff panel:

```
┌─────────────────────────────────────────┐
│  t3-50e.1 · Fix sidebar layout          │
│ Status: in_progress · Formula: mol-do   │
│ [View Bead] [Close Bead] [Show Steps]   │
└─────────────────────────────────────────┘
```

Requires T3 to call `bd show <id> --json` on the server side via a new RPC endpoint.

**Branch ↔ Bead correlation.** Polecat formulas create feature branches per bead. BranchToolbar already shows the current branch — if it matches a bead's branch pattern (e.g. `fix/t3-50e.1-sidebar-layout`), display the bead assignment inline. GitStatusResult already has `branch` and `pr` — adding a `bead` field would close the loop.

## 2. Chat Header — GC Controls

ChatHeader already has: thread title, project badge, GitActionsControl, diff toggle, project scripts, open-in editor.

**Replace/augment the project badge.** For GC-managed threads, show:
- Agent identity badge: `gascity/claude`
- Bead assignment: `t3-50e.1` (clickable → opens bead detail)
- A "GC Managed" indicator with tooltip

**GC action menu.** Add a `GcActionsControl` next to `GitActionsControl` (only visible when `gc.agent` is set):
- **Nudge** — Send a message through `gc nudge` instead of the composer
- **Interrupt** — `gc session interrupt` → maps to `thread.turn.interrupt`
- **Drain** — Signal the agent to wrap up: `gc session drain`
- **View Mail** — Show recent `gc mail` for this agent
- **View Bead** — Expand bead details panel

Maps directly to gc CLI commands. T3 server needs thin RPC wrappers that shell out to `gc` or `bd`.

## 3. Composer — GC-Aware Mode

CompactComposerControlsMenu already has Mode (Chat/Plan) and Access (Supervised/Full access).

**Disable/warn on direct composer input** for GC-managed threads. Agent sessions receive input through `gc nudge`, not the T3 composer. Typing directly could confuse the formula flow. Options:
- Soft warning: "This is a GC-managed session. Messages bypass the GC dispatch pipeline."
- Or: redirect composer input through `gc nudge <agent>` automatically

**Formula step indicator.** If the thread has a molecule, show current step progress in the composer area: `Step 3/5: implement · mol-polecat-commit`

## 4. Sidebar — Formula & Convoy Awareness

Beyond existing GC badge and lifecycle pills:

**Convoy grouping.** When multiple threads in a project belong to the same convoy, group them visually:

```
▼ gascity                    GC 3
  ├─ 📦 t3-50e (convoy)
  │   ├─ claude · Fix sidebar     ● Working
  │   ├─ claude · Add metadata    ✓ Drained
  │   └─ claude · Thread reuse    ○ Stopped
  └─ claude · standalone task     ● Working
```

**Bead queue indicator on projects.** Show count of `bd ready` beads waiting for pool agents: `gascity · 3 queued`

## 5. Implementation Architecture

**How does T3 talk to bd/gc?**

**Option A: Shell exec on server.** T3 server shells out to `bd show --json`, `gc status`, etc. Simple, no new dependencies, requires gc/bd in PATH on the server.

**Option B: New RPC surface.** Add `gc.*` RPC methods to the T3 WebSocket API that gc-session-t3 can call, and the web UI can query.

**Option C: Metadata-only (least coupling).** gc-session-t3 pushes all relevant state as `customMetadata` — bead title, status, molecule step, convoy ID, queue depth. T3 is purely a renderer and never calls gc/bd directly. Downside: metadata can be stale, and action buttons need a way to dispatch commands back.

**Recommended: Option A for reads + Option C for display + gc-session-t3 as the action proxy for writes.** The web UI sends action requests as special thread messages or meta-updates, and gc-session-t3 translates them to gc/bd commands. Keeps T3 decoupled from GC internals.

## Related PRs

- **gascity#38** — Per-agent session provider overrides (sfncore) — GC-side prerequisite
- **gascity#49** — Nudge poller generalization — NudgePollMode field
- **gascity#50** — Worker prompt alignment — WorkQuery template variable
- **gascity#41** — Provider builtin inheritance — mergeProviderOverBuiltin

## Convoy Reference

`t3-50e` — T3 sidebar GC agent session lifecycle & naming (all 8 tasks closed)
