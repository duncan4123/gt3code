# Plan Workflow: DB to UI

This maps the current proposed-plan workflow from persistence through server orchestration to the web UI. It also marks the gaps relative to the bead / convoy / formula workflow we want next.

## Current data model

- Proposed plans are projections, not authoritative event-store rows.
- The sidecar table is `proj.projection_thread_proposed_plans`, created in `apps/server/src/persistence/Migrations/021_MoveProjectionsToBtreeSidecar.ts:172`.
- Schema fields:
  - `plan_id`
  - `thread_id`
  - `turn_id`
  - `plan_markdown`
  - `created_at`
  - `updated_at`
  - `implemented_at`
  - `implementation_thread_id`
- Turn linkage back to the source plan is stored on `proj.projection_turns` via:
  - `source_proposed_plan_thread_id`
  - `source_proposed_plan_id`
  - added in `apps/server/src/persistence/Migrations/015_ProjectionTurnsSourceProposedPlan.ts:9`
  - recreated in sidecar in `apps/server/src/persistence/Migrations/021_MoveProjectionsToBtreeSidecar.ts:144`

## Persistence layer

- Proposed-plan repository:
  - `apps/server/src/persistence/Layers/ProjectionThreadProposedPlans.ts:17`
  - upserts and lists rows from `projection_thread_proposed_plans`
- Turn projection repository:
  - `apps/server/src/persistence/Layers/ProjectionTurns.ts:66`
  - carries `sourceProposedPlanThreadId` / `sourceProposedPlanId`

## Provider ingestion

- Claude plan mode is captured from `ExitPlanMode` / plan-completion events.
- Runtime ingestion buffers plan deltas, then finalizes them into first-class proposed-plan projections:
  - append buffered plan delta: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1081`
  - finalize explicit proposed plan completion: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1095`
  - finalize buffered plan on turn completion fallback: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1166`
- Implementation linkage is updated when a target turn starts from a source plan:
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:835`
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:874`

## Projection pipeline and read model

- Snapshot query loads all projected plans:
  - `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:252`
- Plans are assembled into each thread’s read model:
  - `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:605`
- Latest turn carries optional source-plan reference:
  - `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:651`

## Domain contracts

- Contracts define:
  - `implementationThreadId`
  - `SourceProposedPlanReference`
  - optional `sourceProposedPlan` on turn-start/latest-turn schemas
- Main file:
  - `packages/contracts/src/orchestration.ts:176`
  - `packages/contracts/src/orchestration.ts:266`
  - `packages/contracts/src/orchestration.ts:436`
  - `packages/contracts/src/orchestration.ts:753`

## Web store

- Orchestration snapshot is mapped into web-thread state:
  - `apps/web/src/store.ts:131`
  - `apps/web/src/store.ts:157`
- Live updates merge plan upserts into thread state:
  - `apps/web/src/store.ts:947`
- Pending source plan for an active turn is mirrored from `latestTurn.sourceProposedPlan`:
  - `apps/web/src/store.ts:174`

## Web session logic

- “latest actionable plan” logic is here:
  - `apps/web/src/session-logic.ts:421`
- Sidebar / current-thread plan selection prefers the active turn’s source plan while a turn is running:
  - `apps/web/src/session-logic.ts:451`
- Timeline mixes messages, proposed plans, and work entries:
  - `apps/web/src/session-logic.ts:861`

## Web UI

- Plan sidebar UI:
  - `apps/web/src/components/PlanSidebar.tsx:53`
  - renders active plan steps + proposed plan markdown
- Chat view actions:
  - same-thread plan follow-up uses `thread.turn.start` with `sourceProposedPlan`
    - `apps/web/src/components/ChatView.tsx:3352`
  - new implementation thread also uses `sourceProposedPlan`
    - `apps/web/src/components/ChatView.tsx:3453`
- Timeline includes proposed-plan rows:
  - `apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx:366`

## Current behavior summary

- Plan output is captured from provider runtime events.
- It is projected into sidecar tables.
- The read model exposes proposed plans per thread plus optional source-plan linkage on a running turn.
- The UI can:
  - show the latest plan
  - keep a plan sidebar open
  - continue implementation in the same thread
  - start a new thread from the plan

## What is missing for bead / convoy / formula workflow

Current plan workflow is thread-local. It does not yet create or manage first-class bead / convoy / formula objects.

Missing layers:

- Plan -> bead projection / creation seam
- Plan -> convoy creation / promotion seam
- Formula-specific entities and UI
- Per-message / per-chunk provenance
- Chunk-level reply / synthesize / create-bead actions
- Branch metadata anchored to message / chunk points

## Recommended extension points

Build on the current workflow rather than replacing it:

1. Add `messageId` to search results and scroll-to-hit.
2. Add `message_chunks` as sidecar projections for chunk-level addressing.
3. Add first-class `conversation_artifacts` linked to:
   - `thread_id`
   - `message_id`
   - `chunk_id`
   - optional `plan_id`
4. Add `artifact_kind` values like:
   - `bead_draft`
   - `convoy_draft`
   - `formula_draft`
   - `synthesis`
   - `tag`
5. Add promotion paths from those artifacts into the real bead / convoy backend.

## Short file map

- DB schema:
  - `apps/server/src/persistence/Migrations/021_MoveProjectionsToBtreeSidecar.ts:172`
  - `apps/server/src/persistence/Migrations/015_ProjectionTurnsSourceProposedPlan.ts:9`
- Persistence repo:
  - `apps/server/src/persistence/Layers/ProjectionThreadProposedPlans.ts:17`
  - `apps/server/src/persistence/Layers/ProjectionTurns.ts:66`
- Provider ingestion:
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1081`
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1134`
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1166`
- Read model:
  - `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:252`
  - `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:605`
  - `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:676`
- Web store / logic:
  - `apps/web/src/store.ts:131`
  - `apps/web/src/store.ts:947`
  - `apps/web/src/session-logic.ts:421`
  - `apps/web/src/session-logic.ts:861`
- Web UI:
  - `apps/web/src/components/PlanSidebar.tsx:53`
  - `apps/web/src/components/ChatView.tsx:3352`
  - `apps/web/src/components/ChatView.tsx:3453`
