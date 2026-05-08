# T3Code Gas City Sidebar Audit

## Scope

Audit target: current sidebar plus adjacent thread/session detail surfaces in T3Code.

Questions answered:

- What GC-related data is already present in the web read model?
- What GC controls already exist in the sidebar or nearby surfaces?
- What backend and contract surfaces already exist for Gas City?
- What is missing before operator-facing sidebar controls can ship?

## Current UI Surface

### Sidebar project rows

Current project rows render:

- expand/collapse affordance
- project favicon
- project name
- aggregate thread status dot when collapsed
- new-thread button
- project context menu with `Copy Project Path` and `Remove project`

Current project rows do **not** render:

- rig name
- GC agent count
- GC lifecycle state
- pool/session controls
- rig suspend/resume controls
- convoy/bead grouping

Source: `apps/web/src/components/Sidebar.tsx`

### Sidebar thread rows

Current thread rows render:

- title
- orchestration-derived status pill
- PR badge
- terminal-running badge
- relative timestamp
- archive affordance
- thread context menu with rename/unread/copy path/copy thread id/delete

Current thread rows do **not** render:

- GC agent identity
- bead id/title
- convoy/formula progress
- GC provider/state badges
- GC action controls

Source: `apps/web/src/components/Sidebar.tsx`

### Adjacent session-detail surfaces

Current nearby controls already exposed outside the sidebar:

- `BranchToolbar`: local vs worktree mode, branch/worktree switching
- `GitActionsControl`: commit/push/PR/sync actions
- project scripts menu with static GC command snippets

Missing from adjacent surfaces:

- GC managed-session badge
- GC agent/bead header context
- nudge/drain/interrupt actions
- bead details panel
- formula-step indicator

Sources:

- `apps/web/src/components/BranchToolbar.tsx`
- `apps/web/src/components/GitActionsControl.tsx`
- `apps/web/src/components/ProjectScriptsControl.tsx`

## Current GC Data In Web State

### Data already carried on threads

The orchestration thread contract already carries:

- `branch`
- `worktreePath`
- `session`
- `customMetadata`

`customMetadata` is the only GC-shaped payload currently exposed to the web read model.

Sources:

- `packages/contracts/src/orchestration.ts`
- `apps/web/src/store.ts`
- `apps/web/src/types.ts`

### GC parsing helper exists but is unused

`Sidebar.logic.ts` already defines:

- `getGcMetadata(customMetadata)`
- `countGcAgents(threads, projectId)`

Parsed keys:

- `gc.agent`
- `gc.rig`
- `gc.city`
- `gc.bead`
- `gc.beadTitle`
- `gc.state`
- `gc.provider`

These helpers are imported in `Sidebar.tsx` but not used in current rendering. Today the sidebar has GC parsing code but no GC UI.

Sources:

- `apps/web/src/components/Sidebar.logic.ts`
- `apps/web/src/components/Sidebar.tsx`

## Current Backend / Contract Surface

### Orchestration and websocket surface

Current websocket/native API surface includes:

- orchestration snapshot + command dispatch + diff replay
- server config/settings
- git actions
- terminal actions
- file/project utilities

There is no `gc.*` RPC group and no GC-specific native API surface.

Sources:

- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/rpc.ts`
- `apps/server/src/ws.ts`
- `apps/web/src/wsNativeApi.ts`

### Server-side GC client exists, but is not exposed to the web

Server code already has an internal `GcApiClient` with:

- `getBead`
- `getConvoy`
- `getFormula`
- SSE event stream
- availability probe

This is useful groundwork, but it is currently a server-internal service. No web-facing RPC currently exposes bead/convoy/formula reads or GC operator mutations.

Sources:

- `apps/server/src/gc/Services/GcApiClient.ts`
- `apps/server/src/gc/Layers/GcApiClient.ts`

### GC contracts are mostly schema-only today

`packages/contracts/src/gc.ts` defines:

- GC activity kinds
- bead summary
- convoy summary
- thread GC context

Search results show no runtime consumers beyond the contract file itself. That means the contract exists, but the projector, RPC layer, and web components are not yet wired to use it.

Source: `packages/contracts/src/gc.ts`

## Missing Pieces

### Missing read model for sidebar inventory

The sidebar is project/thread oriented. Gas City operator controls need a rig/agent inventory model. Current project rows do not know:

- configured rig agents
- pool min/max
- named session mode
- wake mode
- suspended state
- agent provider/model defaults

Without a dedicated GC snapshot, the sidebar cannot render live operator controls safely.

### Missing action channel

There is no current web path for:

- `gc nudge`
- `gc session drain`
- `gc session interrupt`
- agent suspend/resume
- rig suspend/resume
- pool size changes
- session mode changes

These need explicit RPC methods or a typed orchestration bridge. Reusing generic thread metadata updates would be wrong for operational GC mutations.

### Missing freshness guarantees

Two different state planes exist:

- orchestration thread/session state
- Gas City runtime/config state

If the UI relies only on thread `customMetadata`, operator controls risk stale labels and stale enable/disable logic. Live sidebar controls need a read path tied to actual GC runtime/config state, not just projected thread metadata.

## Constraints And UX Risks

### Sidebar information density

Current sidebar rows are compact and thread-centric. Adding GC controls directly to each thread row will compete with:

- thread title
- status pill
- PR badge
- terminal badge
- archive affordance

Any design should decide early whether GC controls belong on:

- project rows
- a dedicated rig/agent section
- thread rows only when GC-managed
- a drill-in panel

### Project model does not equal rig model

A T3 project is a workspace root. A Gas City rig is an operational grouping with named agents and pools. One project may need to surface multiple runtime entities. That mapping is not present in current sidebar state.

### Safe mutation requirements

Several likely GC controls are operationally risky:

- session interrupt
- drain
- agent suspend/resume
- pool sizing
- city/rig-level suspend/resume

These need:

- explicit disable predicates
- loading/error states
- stale-state recovery
- confirmation thresholds for destructive actions

## Audit Summary

Current state:

- web read model can already carry GC thread metadata through `customMetadata`
- sidebar has GC parsing helpers but does not render them
- server has an internal GC API client
- websocket/native API exposes no GC-specific reads or writes
- contracts contain GC schemas, but they are mostly not wired into runtime surfaces

Net result:

T3Code has groundwork for GC-aware thread decoration, but not yet the inventory model or RPC surface required for live operator controls in the sidebar.

## Recommended Handoff For Design Task

Design work should treat this as a two-layer feature:

1. Read layer
   - define a dedicated GC sidebar snapshot for rig/agent inventory and live config/runtime state
   - decide which parts stay on thread `customMetadata` versus new GC RPC payloads

2. Action layer
   - add explicit typed GC RPC methods for operator actions
   - avoid overloading orchestration thread metadata updates for GC runtime mutations

Recommended first shipping slice:

- render GC-managed thread badges from existing `customMetadata`
- expose read-only rig/agent inventory in the sidebar
- delay mutating controls until typed RPC + stale-state handling is in place
