# GC Backend / Provider Replacement Contract

Bead `t3-qin.1` asks for the exact Gas City abstractions and invariants T3 must keep stable while replacing the GC beads backend or session provider implementation. This document defines that boundary.

## Goal

T3 may swap:

- the GC beads persistence backend behind Gas City
- the GC runtime provider implementation behind Gas City
- thin T3 integration plumbing that calls the GC API

T3 must **not** change the externally visible GC contract that existing formulas, operators, and UI features already depend on.

## Stable Boundary

### 1. T3 talks to GC through the API, not backend internals

T3-side integration is intentionally thin:

- `apps/server/src/gc/Services/GcApiClient.ts` defines the stable API-facing shapes T3 consumes for beads, convoys, formulas, events, config, and session actions.
- `apps/server/src/gc/Services/GcContextProvider.ts` resolves thread context only from `gc.*` metadata plus live GC API lookups.
- `docs/gascity-domain-summaries.md` states that T3 should use GC REST endpoints and SSE, not CLI- or store-specific behavior.

Implication:

- Replacing Dolt/bd with doltlite is valid if GC still presents equivalent API behavior.
- Replacing a provider implementation is valid if GC still presents equivalent session lifecycle behavior through its API.
- T3 should not couple to `bd` CLI output, Dolt table layout, or provider-specific process control.

### 2. Bead semantics are stable

GC beads are the canonical work-unit model. Backend replacement must preserve:

- identity: stable bead IDs
- core fields: `id`, `title`, `description`, `status`, `priority`, `type`/`issueType`, `assignee`, `parentId`, `ref`, `labels`, `metadata`, `createdAt`, `updatedAt`
- status semantics: `open`, `in_progress`, `closed` at minimum
- type semantics: `task`, `session`, `convoy`, `molecule`, `wisp`
- parent-child relationships
- dependency edges and directionality
- structured filtering by label, assignee, status, type, metadata

T3 currently depends on these via `GcBead` and GC thread metadata. If a new backend cannot preserve these semantics, it is not a drop-in replacement.

### 3. Dependency semantics are stable

Gas City docs describe dependency edges as part of formula and dispatch ordering. Replacement must preserve:

- a bead can depend on another bead without losing identity or ordering meaning
- dependency queries remain accurate enough for ready-queue and convoy progression
- parent-child container structure remains distinct from generic dependency edges

Do not collapse convoy containment, molecule lineage, and blocking dependencies into one ambiguous relationship.

### 4. Provider lifecycle contract is stable

`docs/gascity-domain-summaries.md` describes the runtime `Provider` contract as stable across implementations. Replacement must preserve equivalent behavior for:

- start / stop
- interrupt
- running-state checks
- attach / peek
- nudge / message delivery
- session metadata storage
- last-activity reporting
- capability reporting
- pending interaction / approval handling when supported

T3 does not call providers directly, but it does depend on the API behavior those providers make possible. A replacement provider may change internals, not lifecycle semantics.

## Metadata Contract

The most fragile part of GC integration is thread metadata. `packages/contracts/src/gc.ts` and existing UI/server code already treat these keys as stable.

### 5. Required thread metadata keys

At minimum, GC-managed threads must continue to support:

- `gc.agent`
- `gc.sessionName`
- `gc.rig`
- `gc.city`
- `gc.bead`
- `gc.beadTitle`
- `gc.convoy`
- `gc.convoyTitle`
- `gc.convoyStatus`
- `gc.convoyClosedCount`
- `gc.convoyTotalCount`
- `gc.provider`
- `gc.runtimeProvider`
- `gc.state`
- `gc.sessionEnv`
- `gc.molecule`
- `gc.formula`
- `gc.groupKind`
- `gc.groupId`
- `gc.groupLabel`
- `gc.agentQualified`
- `gc.agentLabel`

Additional keys are fine. Renaming or dropping these is breaking.

### 6. Metadata meaning is stable

These keys are not decorative. Existing code already consumes them for behavior:

- `gc.bead`, `gc.convoy`, `gc.formula` drive `GcContextProvider` lookups.
- `gc.sessionName` is used to re-bind a managed session to the newest active thread.
- `gc.agent`, `gc.rig`, `gc.city`, `gc.group*`, and `gc.agent*` drive sidebar grouping and GC identity display.
- `gc.state` supports lifecycle pills like active, drained, or stopped.
- `gc.sessionEnv` preserves startup environment needed for audit/recovery and session identity.

Replacement work must preserve both key names and meaning.

## Session / Orchestration Contract

### 7. GC-managed nudges go through generic T3 orchestration

`docs/gc-nudge-contract.md` establishes a hard boundary:

- T3 does not expose a dedicated `gc.nudge` or `gc.sessionAction` websocket RPC for message delivery.
- GC-managed message delivery must resolve to the generic `thread.turn.start` orchestration command.
- `gc.nudge.sent` is observational activity, not transport.

Any provider or bridge replacement must keep this path working:

1. GC resolves the target managed session.
2. GC dispatches full `thread.turn.start` command payload into T3.
3. T3 decider emits `thread.message-sent` and `thread.turn-start-requested`.
4. Provider command reactor sends the resolved user text to the runtime provider.
5. Runtime events project back into thread activity and session state.

If a replacement invents a separate message transport, it will diverge from shipped T3 behavior.

### 8. Session identity and rebinding are stable

Existing T3 logic assumes:

- a GC-managed thread can be identified from `gc.*` metadata alone
- session names are durable identifiers for reattachment/rebinding
- the newest active thread binding for a GC session name is queryable from projections
- session restart or thread reuse should not orphan GC-managed context

Backend/provider replacement must preserve these identity guarantees.

### 9. Real-time behavior is stable

GC API and T3 integration both assume:

- structured REST responses for point reads and actions
- structured SSE/event streaming for live updates
- enough fidelity to update sidebar state, bead context, convoy progress, and session activity without polling hacks

Changing streaming transport or event shape is allowed only if T3-visible semantics remain equivalent.

## History / Working-State Requirements

### 10. T3 only needs stable read semantics, not a specific storage engine

For this integration, "history" and "working state" mean:

- bead and convoy current state can be read consistently
- dependencies and children reflect current workflow ordering
- session/thread binding can be recovered after restarts
- projected thread metadata remains sufficient to reconstruct GC context
- lifecycle and activity updates arrive in order well enough for UI state to remain predictable

T3 does **not** require Dolt specifically. It requires durable, queryable, restart-safe state.

### 11. Partial-update semantics must remain safe

GC bead updates are partial. Replacement must preserve:

- metadata merge/update behavior
- label add/remove behavior
- status-only updates without field loss
- parent reassignment and description/title edits without corrupting unrelated fields

This is required for convoy automation and operator tooling to remain predictable.

## Non-Negotiable Invariants

Replacement is acceptable only if all remain true:

- T3 still consumes GC through API/SSE boundaries, not backend internals.
- `GcApiClient` and `GcContextProvider` shapes stay satisfiable without T3-side semantic changes.
- Existing `gc.*` metadata keys and meanings remain stable.
- Bead IDs, statuses, types, labels, metadata, dependencies, and parent-child links remain stable.
- Session identity via `gc.sessionName` remains durable and queryable.
- Managed nudges still enter T3 through generic orchestration `thread.turn.start`.
- Approval/pending interaction behavior still maps to existing session APIs.
- Restart/rebind flows still recover the correct managed thread context.

## Breakage Tests For Follow-On Work

Any doltlite/provider replacement should prove these cases:

- bead read returns the same bead field set for an existing GC-managed task
- convoy status still reports child counts and child summaries
- thread with `gc.bead` / `gc.convoy` / `gc.formula` still resolves full GC context
- session lookup by `gc.sessionName` still finds the newest active thread binding
- sending a managed nudge still produces `thread.turn.start` driven execution
- session restart still preserves GC-managed sidebar grouping and lifecycle state
- metadata-only backfill or patch operations do not erase unrelated `gc.*` fields

## Out Of Scope

This contract does not require:

- preserving Dolt as the storage engine
- preserving `bd` CLI implementation details
- preserving any specific provider implementation such as tmux, ACP, or subprocess
- preserving undocumented wire quirks that are not reflected in the GC API, T3 contracts, or `gc.*` metadata

If those internals change while the contract above remains true, T3 integration should continue to work.
