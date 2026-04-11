## Title

Plan Versioning With Manual Checkpoints, Branch Graphs, and Git-Style Diffs

## Summary

- Persist every manual checkpoint of a proposed plan inside DoltLite so operators have a canonical, branchable history even when threads restart.
- Extend the server snapshot + contracts so web clients can fetch, subscribe to, and diff any two plan versions in-thread.
- Upgrade the PlanSidebar to add a “Save Checkpoint” control, a branch-aware version list, and a Git-style diff viewer that reuses the existing DiffPanel widgets.

## Goals / Non-Goals

- **In scope:** thread-local version graphs with branching metadata, DoltLite-backed persistence, websocket propagation, PlanSidebar UX, and parity diff tooling.
- **Out of scope:** automatic checkpoints on every provider delta (only user-triggered snapshots), formula/bead promotion flows, and server-side semantic diffing beyond markdown text.

## Storage & DoltLite Schema

1. **New tables (sidecar schema `proj`):**
   - `projection_thread_plan_versions` (version_id PK, plan_id FK, thread_id, branch_id, parent_version_id nullable, root_version_id, plan_markdown, turn_id, message_id, created_by_user_id, created_at, auto DoltLite `transaction_id`). Migration file `apps/server/src/persistence/Migrations/023_AddPlanVersioning.ts:1`.
   - `projection_thread_plan_branches` (branch_id PK, plan_id, thread_id, label, head_version_id, created_at) for tracking branch names and latest heads.
   - `projection_thread_plan_branch_links` (version_id, derived_thread_id, derived_turn_id) to preserve the “start new thread from version” relation.
   - Indices: `(plan_id, branch_id)`, `(thread_id, created_at)`, `(plan_id, parent_version_id)`.
2. **Existing tables:**
   - Add `latest_version_id` to `projection_thread_proposed_plans` via the same migration so current plan rows know which version corresponds to the latest checkpoint (`apps/server/src/persistence/Migrations/023_AddPlanVersioning.ts:60`).
   - Add `source_plan_version_id` to `projection_turns` (nullable) for provenance when we start an implementation turn from a plan (`apps/server/src/persistence/Migrations/023_AddPlanVersioning.ts:110`).
3. **Backfill script:** for every existing plan, insert a synthetic “v0” version derived from the most recent `plan_markdown` so history begins populated (Effect pipeline inside the migration file).

## Server & Persistence Layers

1. **Repositories:**
   - Create `apps/server/src/persistence/Layers/PlanVersions.ts:1` with Effect repository functions: `createCheckpoint`, `listByPlanId`, `listByThreadId`, `linkDerivedThread`, `updateBranchHead`.
   - Add service definition in `apps/server/src/persistence/Services/PlanVersions.ts:1` for typing.
2. **Domain services:**
   - Introduce `PlanVersionManager` layer in `apps/server/src/orchestration/Layers/PlanVersionManager.ts:1` that coordinates repository writes, branch graph validation (no cycles), and DoltLite transaction boundaries.
3. **Manual checkpoint command path:**
   - New Native API method `planVersions.createCheckpoint` handled inside `apps/server/src/wsServer.ts:320` that accepts `{ threadId, planId, parentVersionId }`.
   - Handler reads the latest plan projection via `ProjectionThreadProposedPlanRepository` (`apps/server/src/persistence/Layers/ProjectionThreadProposedPlans.ts:17`), validates the requesting session owns that thread, then calls `PlanVersionManager`.
4. **Projection snapshot updates:**
   - Extend `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:605` to join the new tables and assemble a `planVersions` array plus `planBranches` per thread. Include branch adjacency (parent → child list) so the client can build DAGs.
   - Emit live diff events on the `orchestration.domainEvent` channel when checkpoints are created or branch heads move.
5. **Thread linkage:**
   - When `thread.turn.start` is invoked with a `sourceProposedPlan`, capture the selected version id (new optional field) and update both `projection_turns` and `projection_thread_plan_branch_links` to maintain traceability (`apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:835` and `:874`).
6. **Reliability & permissions:**
   - Ensure PlanVersionManager enforces manual snapshots only when a plan exists, denies duplicates with identical `plan_markdown` unless `force` flag is set, and writes structured events for audit logging.

## Contracts & Transport

1. **Types:** extend `packages/contracts/src/orchestration.ts:168` with:
   - `OrchestrationPlanVersion` (id, planId, threadId, branchId, parentVersionId, childrenIds, planMarkdown, createdAt, createdByUserId, linkedTurnId, derivedThreadId).
   - `OrchestrationPlanBranch` with label + headVersionId + rootVersionId.
   - Optional `selectedPlanVersionId` on `OrchestrationLatestTurn`.
2. **Events:** update the websocket payload for snapshot (`orchestration.snapshot`) and incremental `orchestration.planVersion.checkpointed` events so clients can merge updates without reloading entire threads.
3. **Native API schema:** update `apps/web/src/nativeApi/types.ts:1` and server implementation so the PlanSidebar button can call `planVersions.createCheckpoint`.

## Web Store & Session Logic

1. **Store slices:** extend `apps/web/src/store.ts:131` to hydrate `planVersions`/`planBranches` per thread, and `apps/web/src/store.ts:947` to merge live version insertions.
2. **Selectors:** update `apps/web/src/session-logic.ts:421` to compute `latestActionablePlanVersion` (prefers branch head for running turns) and provide helper selectors for DAG traversal (e.g., `selectPlanVersionNeighbors`).
3. **Error handling:** capture websocket errors for checkpoint creation and show toasts via `toastManager`.

## UI / UX (PlanSidebar & Diff Panel)

1. **Checkpoint control:** add a button group near `PlanSidebar` header (`apps/web/src/components/PlanSidebar.tsx:70`) that triggers manual checkpoints. Disable when there is no active plan or an in-flight request.
2. **Version history panel:**
   - Insert collapsible panel above the markdown view showing each branch as a tree (use vertically stacked list with indent + connectors). Each row displays version id, timestamp (reuse `formatTimestamp`), branch label, and derived thread badge if present.
   - Provide actions per row: “View details”, “Set as compare base/target”, and “Start thread from this version” (existing action now passes version id).
3. **Diff UX:**
   - When two versions are selected, render a modal that reuses `apps/web/src/components/DiffPanel.tsx:1` and `DiffWorkerPoolProvider` to show a Git-style side-by-side markdown diff.
   - Precompute markdown diff on the client using the same worker pipeline as Git diffs (buddy hooking).
4. **Branch creation flow:** clicking “Fork branch” in the panel prompts for branch name (optional). If omitted, auto-name `checkpoint-{timestamp}`. Persist via `planVersions.createCheckpoint` with `branchLabel`.
5. **Visual cues:** highlight the branch head that matches `latestTurn.sourcePlanVersionId`, show derived-thread links (badge with thread name), and fall back to linear list if there’s only one branch.

## Observability & Operations

- Emit structured log `plan_version.checkpoint_created` with threadId, planId, versionId.
- Add metrics (counter + timer) inside PlanVersionManager for checkpoint latency.
- Update admin tooling or DevTools view to surface branch graph (optional but recommended for debugging DoltLite state).

## Testing & Verification

1. **Server:**
   - Unit tests for PlanVersionManager ensuring branching rules, duplicate prevention, and derived thread linkage (Effect-based tests under `apps/server/src/orchestration/Layers/__tests__/PlanVersionManager.test.ts:1`).
   - Integration tests for the websocket method `planVersions.createCheckpoint` covering auth and error flows.
   - Migration tests verifying schema + backfill (DoltLite fixture with `bun run test apps/server/...`).
2. **Web:**
   - Store reducer tests for version DAG updates (`apps/web/src/store.test.ts:1`).
   - Session-logic tests verifying `latestActionablePlanVersion`.
   - Component tests for new PlanSidebar controls and Diff modal (React Testing Library + Vitest).
3. **End-to-end smoke:** scripted flow that snapshots a plan, forks a branch, compares versions, and starts a new thread to confirm provenance.
4. **Automation:** finish by running `bun fmt`, `bun lint`, and `bun typecheck` at repo root.

## Assumptions & Defaults

- DoltLite remains the system of record; auto metadata (timestamp, thread, user) from DoltLite is sufficient—no manual checkpoint note field for v1.
- Version history stays thread-local, but we store explicit derived-thread references for forks.
- Manual checkpoints are opt-in and initiated via the PlanSidebar control; no provider-driven auto snapshots.
- Branch diffs reuse existing Git diff UI/worker code without new diff algorithms.
