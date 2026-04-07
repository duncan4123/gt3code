# Convoy Lifecycle Walkthrough: 4-Epic Pool Convoy with Merge Agent

## Setup

- **Convoy:** parent bead with 4 child beads (the epics)
- **Pool agents:** 3 polecat slots, picking work from `pool:polecat` label
- **Named agent:** `merge-agent`, always-on, watches for completed epics, merges to integration branch
- **t3code:** running, connected via t3bridge (or REST API)

---

## Phase 1: Convoy Created

### gascity side

- `gc convoy create` creates parent bead (type: "convoy", status: "open") + 4 child beads (type: "task", status: "open", label: `pool:polecat`)
- Reconciler cycle: `ComputeAwakeSet` sees 4 work beads with `pool:polecat` label, sets `WorkSet["polecat"] = true`
- `buildDesiredState` scales pool to 3 slots (or whatever `scale_check` returns)
- 3 session beads created (state: "creating"), reconciler calls `sp.Start()` for each

### t3code sidebar

```
Project: my-rig
  feature-convoy (0/4 done)              <- virtual folder appears
      Thread: polecat-slot-1 (Connecting...)
      Thread: polecat-slot-2 (Connecting...)
      Thread: polecat-slot-3 (Connecting...)
      Thread: merge-agent (Ready)         <- already alive, named
```

The convoy folder appears immediately because t3bridge dispatches `thread.create` for each session with `gc.convoyId` and `gc.convoyTitle` in customMetadata. `VirtualConvoyGroup` groups them.

---

## Phase 2: Work Starts (3 of 4 epics claimed)

### gascity side

- Each pool slot runs `gc hook --inject` and finds ready beads via `work_query`, claims one
- 3 beads transition: "open" to "in_progress", assignee set
- t3bridge dispatches `thread.activity.append` with kind `gc.bead.claimed` for each
- t3bridge updates `thread.meta.update` with bead title, convoy progress (0/4)
- Each slot gets a `thread.turn.start` with the bead's prompt

### t3code sidebar

```
Project: my-rig
  feature-convoy (0/4 done)
      Thread: polecat-slot-1 - "fix auth module" (Working)
      Thread: polecat-slot-2 - "add user tests" (Working)
      Thread: polecat-slot-3 - "refactor db layer" (Working)
      Thread: merge-agent (Ready)
```

Thread titles update to bead titles. Status pills show "Working" (turn running). The GcContextSidebar for each thread shows the bead ID, description, and convoy progress.

---

## Phase 3: First Epic Completes

### gascity side

- Slot-1's turn completes. Agent calls `bd close <bead-id>`
- Bead transitions: "in_progress" to "closed"
- Event: `bead.closed` fires, t3bridge watcher picks it up
- t3bridge dispatches `thread.activity.append` kind `gc.bead.closed`
- t3bridge updates convoy metadata: `gc.convoyClosedCount = 1`, `gc.convoyTotalCount = 4`
- Slot-1 runs `gc hook --inject` again, finds epic #4 (the 4th bead), claims it
- `thread.meta.update` with new bead title
- `thread.turn.start` with epic #4 prompt

### merge-agent

- Detects closed bead, starts merge turn
- Creates worktree for integration branch
- Cherry-picks/merges slot-1's completed work
- Runs tests on integration branch
- Dispatches `thread.activity.append` kind `gc.merge.completed`

### t3code sidebar

```
Project: my-rig
  feature-convoy (1/4 done) ####....
      Thread: polecat-slot-1 - "add API docs" (Working)       <- picked up epic #4
      Thread: polecat-slot-2 - "add user tests" (Working)
      Thread: polecat-slot-3 - "refactor db layer" (Working)
      Thread: merge-agent - "merge: fix auth module" (Working)
```

Progress bar updates. Slot-1's title changed to the new bead. Merge agent shows it's working. Each thread's GcContextSidebar shows the worked beads history -- slot-1 shows "fix auth module (completed)" in its completed list.

---

## Phase 4: Epics 2 & 3 Complete, Pool Drains

### gascity side

- Slots 2 and 3 complete their beads, `bead.closed` events fire
- Convoy progress: 3/4
- No more unclaimed beads, so slots 2 and 3 have no work
- `ComputeAwakeSet`: no `WorkSet` demand, slots 2 and 3 get drain decision
- Reconciler drains sessions: `thread.session.stop` + `thread.archive`
- merge-agent picks up both completed epics, merges sequentially

### t3code sidebar

```
Project: my-rig
  feature-convoy (3/4 done) ######..
      Thread: polecat-slot-1 - "add API docs" (Working)       <- still on epic #4
      Thread: polecat-slot-2 (Drained)                         <- archived/grayed
      Thread: polecat-slot-3 (Drained)                         <- archived/grayed
      Thread: merge-agent - "merge: refactor db layer" (Working)
```

Drained threads get "Drained" status pill and gray out. They stay in the convoy folder (not moved to archive) because they're still part of the convoy context. The sidebar shows the fleet winding down.

---

## Phase 5: Last Epic Completes, Convoy Auto-Closes

### gascity side

- Slot-1 completes epic #4, `bead.closed` fires
- Convoy progress: 4/4
- `doConvoyAutocloseWith()` fires, parent convoy bead status becomes "closed"
- merge-agent merges the final epic, runs full integration test suite
- Slot-1 drains (no work left)
- merge-agent's turn completes, goes idle

### t3code sidebar

```
Project: my-rig
  feature-convoy (4/4 done) ######## (completed)
      Thread: polecat-slot-1 (Drained)
      Thread: polecat-slot-2 (Drained)
      Thread: polecat-slot-3 (Drained)
      Thread: merge-agent (Ready)         <- back to idle
```

Convoy folder shows completed status. All pool threads drained. Merge agent returns to ready state. The GcContextSidebar for any thread shows the full worked beads history -- which epics it handled, when they completed, and the merge status.

---

## Post-Convoy

The convoy folder could collapse to a summary line or move to an "archive" section. Clicking it expands to show the thread history. The merge-agent thread persists (named, always-on) ready for the next convoy.

---

## Data Flow Summary

Every state change flows through this pipeline:

```
gascity bead event
    |
    v
t3bridge: thread.meta.update / thread.activity.append
    |
    v
t3code orchestration event (22 types, with correlationId)
    |
    v
Zustand store: applyOrchestrationEvent()
    |
    v
Sidebar re-render: VirtualConvoyGroup + status pills + progress
```

The convoy folder, progress bar, thread status pills, and bead history all update in real-time via the event subscription.

---

## Key Metadata Keys (set by t3bridge on thread.customMetadata)

| Key                    | Purpose                               |
| ---------------------- | ------------------------------------- |
| `gc.agent`             | Agent qualified name                  |
| `gc.rig`               | Rig name                              |
| `gc.city`              | City name                             |
| `gc.bead`              | Current bead ID                       |
| `gc.beadTitle`         | Current bead title                    |
| `gc.state`             | Session state (active/asleep/drained) |
| `gc.provider`          | Provider name                         |
| `gc.convoy`            | Convoy ID                             |
| `gc.convoyTitle`       | Convoy title                          |
| `gc.convoyStatus`      | Convoy status                         |
| `gc.convoyClosedCount` | Completed beads in convoy             |
| `gc.convoyTotalCount`  | Total beads in convoy                 |
| `gc.formula`           | Formula name (if workflow)            |
| `gc.molecule`          | Molecule ID (if workflow instance)    |
