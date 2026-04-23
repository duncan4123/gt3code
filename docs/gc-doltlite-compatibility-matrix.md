# GC Doltlite Compatibility Matrix

Bead `t3-qin.2` asks for a backend matrix that compares current Gas City bead-store behavior with a doltlite target. This document uses the stable `beads.Store` contract plus the shipped implementations in `gascity/internal/beads` as the source of truth.

## Scope

Current GC bead-store implementations:

- `MemStore`: in-memory test/double store
- `FileStore`: JSON file persistence layered over `MemStore`
- `BdStore`: production store that shells out to `bd`, which persists to Dolt

Also present but not treated as a distinct persistence backend here:

- `exec.Store`: script-backed adapter used to satisfy the same `beads.Store` contract

Target under evaluation:

- `DoltliteStore`: a new `beads.Store` implementation backed by doltlite in-process, while preserving Gas City semantics

## Stable Requirements

The non-negotiable contract is already captured in [gc-backend-provider-replacement-contract.md](/data/projects/t3code/docs/gc-backend-provider-replacement-contract.md). In short, a valid replacement must preserve:

- bead CRUD with stable IDs and default semantics
- labels, metadata merge behavior, parent-child links, and dependency edges
- ready-queue behavior and query filtering
- convoy and molecule/wisp behavior built on top of ordinary beads
- restart-safe current-state reads
- partial-update safety
- enough consistency for session rebinding, convoy progression, and UI projections

## Matrix

| Requirement                            | MemStore                | FileStore              | BdStore (Dolt via `bd`)              | Doltlite target | Notes / gap                                                                                                                                      |
| -------------------------------------- | ----------------------- | ---------------------- | ------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create / Get / Update / Close / Delete | Yes                     | Yes                    | Yes                                  | Must match      | Core `beads.Store` surface.                                                                                                                      |
| Default ID / status / type semantics   | Yes                     | Yes                    | Yes                                  | Must match      | IDs may differ in format, but must stay stable and non-empty.                                                                                    |
| Labels and metadata updates            | Yes                     | Yes                    | Yes                                  | Must match      | Metadata merge semantics are required; destructive replace is not acceptable.                                                                    |
| Batch metadata update                  | Atomic in-process       | Atomic per file flush  | Sequential, partial failure possible | Prefer atomic   | Doltlite can improve on `BdStore`, but must remain idempotent-safe.                                                                              |
| Parent-child relationships             | Yes                     | Yes                    | Yes                                  | Must match      | Convoys and molecules depend on this staying distinct from generic deps.                                                                         |
| Blocking dependencies                  | Yes                     | Yes                    | Yes                                  | Must match      | `DepAdd`, `DepRemove`, `DepList`, and `Ready()` semantics must hold.                                                                             |
| Ready queue filtering                  | Yes                     | Yes                    | Yes                                  | Must match      | Must exclude infrastructure types the same way current store does.                                                                               |
| Query filtering / targeted list        | Yes                     | Yes                    | Yes                                  | Must match      | `ListQuery` behavior and `AllowScan` guard must remain intact.                                                                                   |
| Convoy behavior                        | Works logically         | Works logically        | Production path                      | Must match      | Convoys are just beads + child/dependency semantics; no special backend escape hatch.                                                            |
| Molecule / wisp expansion              | Works logically         | Works logically        | Production path                      | Must match      | Same requirement as convoy: preserve ordinary bead semantics.                                                                                    |
| Working-state durability               | No                      | Yes                    | Yes                                  | Yes required    | MemStore is not restart-safe; doltlite must be.                                                                                                  |
| Crash / restart recovery               | No                      | Limited local recovery | Yes                                  | Yes required    | Doltlite must preserve current bead state across process restarts.                                                                               |
| Concurrent writers                     | Process-local lock only | File lock + reload     | Backed by Dolt server / `bd`         | Must be safe    | Doltlite needs a clear concurrency model; silent corruption is unacceptable.                                                                     |
| History / audit trail                  | No                      | Current-state only     | Strongest current option             | Partial gap     | `t3-qin.2` only requires current-state compatibility. Full Dolt-style history is a follow-on design choice unless GC code already depends on it. |
| Server expectations                    | None                    | None                   | Yes                                  | Partial gap     | Some operator workflows assume Dolt-backed tooling. A doltlite backend must either satisfy those expectations or narrow them behind diagnostics. |
| Operational diagnostics                | Minimal                 | Minimal                | Mature `bd`/Dolt tooling             | Gap             | T3 will need backend provenance and mismatch diagnostics (`t3-qin.4`).                                                                           |

## Behavior-by-Behavior Assessment

### Issue CRUD

Status: compatible

Doltlite can satisfy CRUD directly. The important part is not storage engine parity, but preserving `beads.Store` semantics:

- create assigns ID, `open` status, and default `task` type
- point reads return the full bead shape
- partial updates do not erase unrelated fields
- close remains idempotent

### Labels

Status: compatible

Current stores support additive label updates and selective removal. Doltlite must preserve this exact behavior because queueing, mail, and routing use labels operationally.

### Parent-child and blocks dependencies

Status: compatible

This is the heart of convoy behavior. Doltlite does not need new concepts; it must keep the same distinction current GC code already relies on:

- `parent-child` for convoy / molecule containment
- `blocks` and related dep types for readiness ordering

### Convoys and molecule expansion

Status: compatible

No separate persistence primitive is required. Current GC behavior layers convoy and molecule logic on top of ordinary bead reads, child queries, and dependency traversal. If doltlite preserves those reads and writes, convoy behavior should remain intact.

### History semantics

Status: partial gap

Current T3 integration requires durable current state and restart-safe reads. It does not require exposing Dolt commits directly. But Dolt currently provides strong operator ergonomics around:

- audit/debug visibility
- diff/history inspection
- cleanup and backup workflows

A doltlite backend is compatible for T3 if current-state semantics stay intact. It is not yet a full operational substitute for Dolt until those visibility gaps are covered elsewhere.

### Working state and restart behavior

Status: required

This is a hard requirement. T3 and GC both assume:

- the latest bead state is durable
- thread/session rebinding can recover from stored state
- convoy progression survives process restarts

Doltlite is acceptable only if it behaves like `BdStore` here, not like `MemStore`.

### Server expectations

Status: partial gap

Some current workflows are explicitly Dolt-shaped:

- `bd` and GC doctor checks look for Dolt topology/config
- operators expect backend provenance and health diagnostics
- cleanup/perf guidance assumes Dolt-backed stores

That does not block a doltlite backend, but it means the migration must ship:

- explicit backend provenance
- compatibility diagnostics
- clear failure/mismatch reporting

Those gaps map directly to `t3-qin.4`.

## What Doltlite Must Prove

Before `t3-qin.3` starts, the doltlite backend should prove:

1. It passes the existing `beadstest.RunStoreTests` conformance suite.
2. It preserves `ListQuery`, `Ready()`, child queries, and dependency traversal semantics.
3. It survives restart and returns identical bead metadata/state afterward.
4. It supports partial metadata updates without unrelated field loss.
5. It behaves safely under the expected concurrency model for GC and T3.

## Recommended Sequencing

- `t3-qin.2`: document the matrix and pin the semantic bar
- `t3-qin.3`: implement `DoltliteStore` against `beads.Store`
- `t3-qin.4`: add backend provenance and diagnostics so operators can tell Dolt vs doltlite apart
- `t3-qin.5`: add `t3code` provider support on top of the stable backend contract
- `t3-qin.9`: add end-to-end conformance coverage for restart, convoy, and degraded-state behavior

## Bottom Line

Doltlite looks viable as a GC beads backend for T3 if it targets the `beads.Store` contract, not Dolt internals. The main compatibility risk is not CRUD or dependency modeling. The real gaps are operational:

- restart-safe durability
- concurrency safety
- diagnostics/provenance
- replacing Dolt-specific operator visibility with backend-agnostic checks

That means `t3-qin.3` is feasible, but it should be paired with `t3-qin.4` and `t3-qin.9`, not treated as a storage swap in isolation.
