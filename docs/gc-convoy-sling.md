# GC Sling Lifecycle Trace

This reference captures how a bead that gets slung to `t3code/codex` or `t3code/claude` shows up inside T3, which instrumentation currently exists, and which transitions are still invisible. Use it when validating convoy pickup or debugging pool worker drift.

## Lifecycle at a Glance

| Stage                     | Upstream trigger                                                | What T3 records today                                                                                        | Expected state markers                                                                       |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1. Bead & convoy seeding  | `bd` issue + `pool:t3code/*` label, optional convoy parent      | GC API surfaces bead/convoy fields (`status`, `priority`, child beads) that we fetch via `GcApiClient`       | Bead `status` (open, in_progress, closed), convoy `status` (open/closed) and progress counts |
| 2. Sling & wake           | Operator runs `gc sling <agent> <bead>` then `gc hook --inject` | Provider adapters only get GC env vars via `gc-session-t3` env file; no chat artifact is emitted yet         | Bead id, target agent, convoy id                                                             |
| 3. Worker pickup          | `gc-session-t3` starts the provider process                     | `GcEventIngestion` appends `gc.session.*` / `gc.bead.*` activities which the UI renders as GC timeline cards | `gc.session.started`, `gc.bead.claimed`, `gc.bead.closed`, etc.                              |
| 4. Thread metadata sync   | `gc-session-t3` sends `thread.meta.update` patches              | Server merges `gc.*` keys and exposes them via websocket + `gc.getThreadContext`                             | `gc.agent`, `gc.rig`, `gc.bead*`, `gc.formula`, `gc.convoy*`, `gc.state`, Dolt info          |
| 5. Convoy virtual folders | Threads share `gc.convoy` metadata                              | `Sidebar` groups matching threads under a convoy folder with status/progress badges                          | folder label = `gc.convoyTitle` (fallback id), status/progress counts                        |
| 6. Drain / archive        | `gc session drain/archive` transitions                          | `gc.state` drives sidebar pills + archived bucket rendering                                                  | `active`, `stopped`, `drained`, `archived`                                                   |

The sections below link each stage to concrete files and call out the gaps.

## 1. Bead + Convoy Seeding

- `GcApiClient` normalizes bead and convoy payloads from the GC REST API, exposing bead `status`, `priority`, and convoy `children` plus `closedCount/totalCount` (`apps/server/src/gc/Layers/GcApiClient.ts:30-71`).
- `ProjectScriptsControl` ships presets for `gc convoy list`, `gc convoy check`, and `gc sling`, which is how operators seed the queue for pool workers (`apps/web/src/components/ProjectScriptsControl.tsx:79-140`).
- Because bead creation happens in GC, T3 only sees a bead once the provider session starts or `gc.getThreadContext` resolves it; there is no local persistence of convoy metadata besides the GC API call.

## 2. Sling & Wake Inputs

- Operators sling to either `t3code/codex` or `t3code/claude`; `gc hook --inject` is the wake signal (same preset list as above).
- `gc-session-t3` writes one env file per thread under `/tmp/gc-session-t3/thread-<threadId>.env.json`; both provider adapters merge those vars into the runtime environment so Codex and Claude see `GC_AGENT`, `GC_BEAD`, convoy ids, etc. (`apps/server/src/provider/Layers/CodexAdapter.ts:80-86`, `apps/server/src/provider/Layers/ClaudeAdapter.ts:2610-2620`).
- Missing today: no orchestration event ties the sling/wake action to a T3 thread. `docs/design-gc-chat-displays.md:207-240` already flags that bead assignments are only implied via metadata and need a first-class `GcWorkAssignmentCard`.

## 3. Worker Pickup Telemetry

- Once the agent boots, `gc-session-t3` streams SSE events; `GcEventIngestion` listens to `GcApiClient.streamEvents`, matches threads by `customMetadata["gc.agent"]`, and appends `gc.<event.type>` activities with the payload mirrored into `activity.payload` (`apps/server/src/gc/Layers/GcEventIngestion.ts:1-88`).
- The client derives timeline entries from those activities: `deriveGcTimelineEvents` keeps every `gc.*` activity and tags bead-specific fields, while `deriveWorkedBeadHistory` condenses `gc.bead.*` events into the “worked bead” list shown in the GC sidebar (`apps/web/src/session-logic.ts:520-602`). `MessagesTimeline` renders them through `GcEventCard`, showing rig badges and payload details (`apps/web/src/components/chat/MessagesTimeline.tsx:859-903`).
- Tests cover the expected event names (`gc.session.started`, `gc.bead.claimed`, `gc.bead.closed`), which correspond to “wake complete”, “worker claimed bead”, and “worker finished bead” states (`apps/web/src/session-logic.test.ts:933-1044`).

## 4. Thread Metadata + Context Panels

- `thread.meta.update` events merge new `gc.*` keys into the projection model, keeping existing metadata unless a key is explicitly overwritten (`apps/server/src/orchestration/projector.ts:292-313`).
- `getGcMetadata` enumerates every `gc.*` key that the UI expects (`agent`, `rig`, `bead*`, `formula`, `convoy*`, `dolt*`, `state`, `provider`) and down-levels the flags the rest of the UI consumes (`apps/web/src/components/Sidebar.logic.ts:27-87`).
- `docs/design-gc-chat-displays.md:131-158` lists the same keys as the canonical contract from `gc-session-t3`, plus the lifecycle states the session reports (`active`, `stopped`, `drained`, `archived`).
- When the GC sidebar is open, the web client calls `gc.getThreadContext`, which proxies to `GcContextProvider` → `GcApiClient` to hydrate bead descriptions, convoy children, and formula steps beyond what metadata already contains (`apps/server/src/wsServer.ts:889-901`, `apps/server/src/gc/Layers/GcContextProvider.ts:15-38`, `apps/web/src/components/GcContextSidebar.tsx:52-211`).

## 5. Convoy Virtual Folder Placement

- Threads are split into standalone threads (no `gc.convoy`) and convoy groups. `groupThreadsByVirtualConvoy` buckets by normalized convoy id, tracks shared `formula/molecule`, and carries progress numbers when metadata provided them (`apps/web/src/components/Sidebar.logic.ts:118-173`).
- The sidebar renders each convoy as a collapsible folder, showing label, closed/total counts, convoy `status`, `formula`, `molecule`, and the number of worker threads underneath (`apps/web/src/components/Sidebar.tsx:1340-1665`). That section provides the “virtual folder placement” asked for in the issue.
- `docs/design-gc-sidebar-integration.md:62-74` documents the intended UX (group related workers under one convoy entry and expose bead queue depth), matching the current implementation except for the queue indicator (see gaps below).

## 6. Drain / Archive Lifecycle

- `gc.state` is treated as the source of truth for lifecycle transitions. `isThreadArchived` sends any `drained` or `archived` thread into the archived bucket, while `resolveThreadStatusPill` renders `Drained`/`Stopped` pills whenever the GC state is set and the provider session is idle (`apps/web/src/components/Sidebar.logic.ts:89-257`).
- `docs/design-gc-chat-displays.md:160-186` calls out the four GC session states we receive from `thread.meta.update`; today they only surface via sidebar pills and GC Context rows, so the drain/archive lifecycle is visible but still easy to miss in chat history.

## Missing Transitions / Observability Gaps

1. **Sling & wake are invisible.** We do not emit a `gc.sling.*` or `gc.wake.*` activity before `gc.session.started`, so there is no timeline event proving that a bead ever entered the pool queue. This is exactly the gap described in `docs/design-gc-chat-displays.md:207-240`, where `GcWorkAssignmentCard` is still TODO. Until that lands, the only confirmation is that a worker eventually starts.
2. **Queue depth is not surfaced.** The sidebar spec proposes a `bd ready` counter per project (`docs/design-gc-sidebar-integration.md:62-74`), but no component currently shells out to `bd ready` or stores queue metrics, so ops can’t verify how many beads are waiting for `t3code/*` pool workers.
3. **Session lifecycle lacks timeline hooks.** Beyond `GcEventCard` entries triggered by GC SSE, state flips such as `drained` or `stopped` only change metadata (`docs/design-gc-chat-displays.md:160-186`). We should emit a synthetic `gc.session.state` activity whenever `gc.state` changes so the drain/archive transition shows up in history.
4. **Convoy archival is one-way.** Convoy folders collapse automatically when every thread switches to archived, but there’s no metadata tying the convoy’s `status` to a drain action or to GC’s `convoy check`. We rely entirely on whatever `gc.convoyStatus` string `gc-session-t3` sets, and there is no validation step in T3.

These are the areas to poke when validating convoy sling pickup end-to-end.
