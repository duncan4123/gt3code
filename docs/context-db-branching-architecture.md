# Context DB and Branching Architecture

## Goal

Support branchable, searchable, GC-compatible context for:

- a single thread
- a convoy or set of convoys
- an entire rig / project

without making FTS or denormalized read models authoritative.

## Core Principles

- Authoritative state lives in `prolly`.
- Search, projections, and FTS live in attached `btree` sidecars.
- GC remains the semantic authority for beads / convoy behavior.
- T3Code owns local routing, attachment, and retrieval mechanics.
- Old branches remain searchable; only the active branch is authoritative.

## Storage Model

### 1. Rig Control DB

One rig-level control database always exists.

Purpose:

- thread -> context DB binding
- active branch selection
- session / mail / control-plane state
- mount registry
- convoy / project / rig assignment metadata

Suggested ownership:

- authoritative control-plane metadata only
- no duplicated thread transcript text
- no FTS as source of truth

Suggested tables:

- `context_databases`
- `context_bindings`
- `context_branches`
- `context_mounts`
- `session_*`
- `mail_*`

### 2. Context DBs

Each context DB is one logical unit implemented as:

- `main` = doltlite / `prolly`
- `sidecar` = attached SQLite `btree`

Possible scopes:

- thread
- convoy
- project

Each context DB may be branched.

### 3. Inside Each Context DB

#### `prolly` side

Authoritative, branchable state:

- real GC rig/beads schema:
  - `issues`
  - `dependencies`
  - `labels`
  - `comments`
  - `events`
  - `config`
  - `metadata`
  - `custom_types`
  - `custom_statuses`
  - `routes`
  - any other GC-required rig tables
- authoritative conversation/event facts for that scope
- authored syntheses / corrections / promoted notes
- chunk lineage / branch metadata when needed

#### `btree` side

Derived, rebuildable state:

- projected thread/message text
- FTS5 tables
- chunk search tables
- denormalized read models
- cached retrieval helpers
- optional branch-scoped search/materialized views

## Authority Rules

- Thread transcript/event sink is fixed at thread start.
- A thread has exactly one active write binding for its current context target.
- Attached non-active DBs are read-only search / retrieval sources.
- FTS is never authoritative.
- Branching changes authoritative lineage in `prolly`; search is rebuilt in `btree`.

## Branching Model

Three useful branch modes:

1. `context branch`
   - fork context/history at a turn or chunk
   - stay in the same thread UI
2. `session branch`
   - fork to a new live agent session
3. `thread branch`
   - create a new visible thread from a point in another thread

Required metadata:

- `branch_id`
- `parent_branch_id`
- `fork_point_event_id` or `fork_point_chunk_id`
- `is_active`
- `superseded_by_branch_id`

Search behavior:

- default: active branch first
- optional: include ancestors
- optional: include superseded branches with lower rank

## Chunk-Centric Workflow

Chunks become first-class retrieval and synthesis anchors.

Needed records:

- `chunks`
- `chunk_sets`
- `chunk_set_members`
- `syntheses`
- `artifact_links`

This enables:

- reply to chunk(s)
- ask questions about chunk ranges
- synthesize understanding
- create bead / convoy from chunk-derived synthesis
- tag or pin a correction / decision
- link back to source turns and branches

## Multi-Agent Knowledge Model

Agents should be able to:

- inspect branch / commit / tag history
- search annotated chunks across chats
- pull surrounding context
- find promoted syntheses, corrections, and decisions

Recommended first-class promoted artifact:

- `insights`
  - source chunk ids
  - source turn / branch
  - kind (`correction`, `decision`, `warning`, `bead_seed`, `convoy_seed`)
  - text
  - tags
  - author agent
  - supersession metadata

## Feature Ideas

### 1. Reply to Chunk(s)

Allow a user or agent to select:

- one chunk
- a contiguous range of chunks
- a saved chunk set

Then ask a question or continue discussion from that selection.

Rough flow:

1. user selects chunk(s)
2. UI creates or references a `chunk_set`
3. prompt is sent with:
   - selected chunk text
   - source thread / branch metadata
4. result is stored as a synthesis or reply artifact
5. artifact links back to the source chunks

### 2. Synthesize from Chunk(s)

Turn selected chunk(s) into a reusable artifact:

- summary
- correction
- decision
- warning
- open questions

Rough flow:

1. select chunk(s)
2. choose synthesis type
3. generate synthesis
4. store authoritative synthesis record in `prolly`
5. index it for search in `btree`

### 3. Create Bead / Convoy from Conversation

Create structured work directly from a chunk or synthesis.

Rough flow:

1. select chunk(s) or a synthesis
2. choose:
   - create bead
   - create convoy
3. create GC-compatible records
4. link created issue(s) back to:
   - source chunk ids
   - source thread id
   - source branch id

This preserves provenance and makes later retrieval explainable.

### 4. Branch from a Turn / Chunk

Create an alternate line of work from a specific point.

Possible modes:

- branch context only
- branch to a new session
- branch to a new thread

Rough flow:

1. pick fork point at event or chunk
2. create new branch metadata in `prolly`
3. rebind future work to the new branch
4. rebuild / scope search projections for the branch

### 5. Promote Local Understanding to Shared Context

Take a thread-local synthesis and publish it upward.

Targets:

- convoy context
- project context
- rig-wide context

Rough flow:

1. create a synthesis locally
2. choose promotion target
3. copy/promote authoritative artifact into the shared context DB
4. retain links back to original source chunks and thread branch

### 6. Tag / Pin Important Understanding

Mark specific syntheses or corrections as important for future retrieval.

Example tags:

- `decision`
- `correction`
- `warning`
- `bead_seed`
- `convoy_seed`
- `pinned`

Rough behavior:

- tagged artifacts rank higher in retrieval
- other sessions can search by tag
- agents can pull high-signal insights instead of raw transcript first

### 7. Cross-Session / Cross-Agent Discovery

Let other agents find useful work from other threads.

Rough flow:

1. inspect branch / commit / tag history
2. search FTS across annotated chunks and syntheses
3. load surrounding context
4. continue work from the promoted artifact instead of replaying all transcript

This is the core multi-agent memory behavior.

### 8. Chunk Markers in Conversation

Make chunk boundaries visible and interactive in the UI.

Useful actions:

- click to select chunk
- shift-click to select range
- hover to show chunk id / provenance
- jump from synthesis or bead back to source chunk

Design intent:

- lightweight structural markers
- not visually heavy
- only emphasized during selection, search, or provenance navigation

### 9. Search with Authority Awareness

Search should be branch-aware and authority-aware.

Default behavior:

- prefer active branch artifacts
- include ancestors where useful
- include superseded branches at lower rank
- rank tagged syntheses and corrections above raw transcript matches

This avoids stale context silently winning over newer understanding.

### 10. Ask This Branch / Ask This Convoy

Treat a branch or shared context as a searchable reasoning target.

Examples:

- ask this branch what changed since the fork
- ask this convoy what decisions are still unresolved
- ask this project context what prior attempts failed

Rough implementation:

- resolve target DB + branch
- retrieve relevant chunks, syntheses, and tagged artifacts
- assemble prompt from authoritative + indexed context

## Integration Boundary with GC

GC should not manage SQLite mechanics directly.

GC should assign policy:

- `context_scope`
- `context_db_id`
- `context_branch`

T3Code should resolve:

- DB path
- attachment / mounting
- read/write routing
- retrieval composition

For backend compatibility, the storage unit should support the full GC rig schema and behavior, not just a beads-like subset.

## First Proof of Concept

Keep the first spike narrow.

### POC shape

- one rig control DB
- one hybrid thread context DB
- one active thread binding

### POC proves

- real GC beads tables in `prolly`
- projected message text + FTS5 in `btree`
- thread -> context binding in control DB
- branch a thread context from a point
- old branch remains searchable
- active branch remains authoritative

### POC does not need

- convoy/project sharing
- full migration of existing T3Code persistence
- all derived GC helper tables
- broad UI changes

## Recommended Build Order

1. Restore / verify T3Code + doltlite + FTS5 on latest commits.
2. Prove one hybrid context DB with `prolly` main and `btree` sidecar.
3. Add the rig control DB and explicit thread binding.
4. Add chunk markers and chunk-addressable synthesis.
5. Add branch metadata and branch-aware retrieval.
6. Wrap the storage unit behind a GC-compatible backend boundary.

## Open Questions

- Which GC rig tables are strictly required for the first backend-compatible cut?
- Should authored syntheses live in the same `prolly` store as beads, or in a neighboring authoritative table set?
- Do we branch at event boundaries, chunk boundaries, or both?
- How should promotion from thread-local context to convoy/project context be represented?
- Which T3Code thread/session facts remain outside the context DB even in the long-term design?
