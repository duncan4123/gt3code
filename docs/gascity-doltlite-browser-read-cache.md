# Gas City DoltLite Browser Read Cache

This note describes a possible future architecture for using DoltLite in the
browser as a read cache for Gas City and T3 Code. It is not the current runtime
model.

## Current Model

Today the authoritative bead store lives on the server side:

```text
T3 browser
  -> T3 server API/WebSocket
  -> Gas City supervisor
  -> bd CLI / Beads store
  -> city .beads/doltlite/*.db
```

The browser renders state returned by the T3 server. The server owns agent
execution, worktrees, provider sessions, and bead writes. For reliability, the
server must remain the source of truth because agents continue running when no
browser tab is open.

## Proposed Read-Cache Model

A browser DoltLite cache could mirror the server bead store for low-latency UI
queries:

```text
Server authoritative path:
  Gas City supervisor -> bd -> .beads/doltlite/*.db

Browser read path:
  T3 server change feed -> browser worker -> DoltLite WASM/OPFS cache -> UI
```

The browser copy would be read-optimized. It should not be authoritative for
agent coordination, lifecycle decisions, bead claims, or writes that affect
running sessions.

## Sync Shape

The server would expose an ordered change feed for bead-store changes:

- snapshot id or database generation
- monotonically increasing sequence number
- operation type, affected bead id, and normalized payload
- commit/checkpoint marker for transactional batches
- optional compacted snapshot URL for cache rebuilds

The browser would apply changes in a Web Worker to a DoltLite WASM database,
stored in Origin Private File System when available. If the feed has a sequence
gap, schema mismatch, or checksum mismatch, the browser discards the local cache
and rebuilds from a server snapshot.

## Write Policy

Initial implementation should be read-only:

- UI queries may read from browser DoltLite.
- All mutations still go to the T3 server/Gas City API.
- The server applies the mutation to the authoritative bead store.
- The browser observes the resulting change through the feed.

This avoids split-brain behavior. Browser-originated optimistic UI can be added,
but it must reconcile against the server commit sequence.

## Cache Contents

Good candidates:

- bead list/search projections
- dependencies
- labels and metadata used by sidebar/grouping views
- convoy and thread association projections
- denormalized read tables for graph/timeline rendering

Poor candidates:

- provider credentials
- session process state
- active claim/lock ownership
- worktree paths that should only be trusted server-side
- any state required for agents to make progress while the browser is closed

## Benefits

- Fast local filtering, search, and graph rendering.
- Lower server query load for sidebar and dashboard views.
- UI remains inspectable during temporary network loss.
- The cache can be rebuilt safely because the server remains authoritative.

## Risks

- Schema/version drift between server and browser cache.
- Multiple tabs applying the same feed differently.
- Large snapshots causing browser storage pressure.
- Mistaking cached state for authoritative process/session state.
- Complex debugging if UI reads stale cached rows without clear diagnostics.

## Guardrails

- Treat the browser database as disposable.
- Show cache generation, last sequence, and staleness in diagnostics.
- Never hide server-returned threads because of cache contents.
- Prefer server state for lifecycle controls and error displays.
- Keep a server-only fallback query path for every cached view.
- Add cache invalidation on app version, schema version, city id, or rig binding
  changes.

## Suggested Implementation Phases

1. Add a server-side normalized bead projection endpoint.
2. Add a read-only browser worker that builds an in-memory cache from snapshots.
3. Move sidebar/search reads behind a cache-or-server adapter.
4. Persist the cache in OPFS with schema/version invalidation.
5. Add an ordered incremental change feed.
6. Add diagnostics for cache health, rebuild count, lag, and fallback use.

Do not make browser DoltLite authoritative until the sync protocol has explicit
conflict handling, multi-tab coordination, transactional replay, and recovery
tests.
