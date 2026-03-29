# Skip Streaming DB Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate intermediate streaming DB writes that trigger doltlite's `streamingMerge` corruption bug, without breaking the turn lifecycle or UI state.

**Architecture:** When a `thread.message-sent` event has `streaming=true` and the message already exists in the DB, skip all projector writes and batch the dolt_commit instead of committing immediately. The initial message creation (first streaming event) and the final message (streaming=false) still write normally. The UI shows streaming content via WebSocket push — it never reads intermediate state from the DB.

**Tech Stack:** Effect, DoltliteClient (better-sqlite3 + libdoltlite.a), Vitest

---

## Constraints

1. **The initial message creation MUST still happen.** The first `thread.message-sent` with `streaming=true` creates the message row (empty text, `is_streaming=1`). Without this, the final non-streaming event has nothing to update.

2. **The turn projector MUST process the first streaming event.** It sets `assistantMessageId` on the turn. Subsequent streaming events don't change the turn state — they're redundant upserts.

3. **The final non-streaming event MUST run through all projectors.** It writes the complete text, sets `is_streaming=0`, sets turn `state=completed` and `completedAt`. If this doesn't run, the React `markThreadVisited` effect loops because `completedAt` is null.

4. **dolt_commit should NOT fire on every streaming chunk.** Currently `thread.message-sent` resets `sinceLastCommit=0`, forcing an immediate commit. Streaming events should batch like other high-frequency events.

5. **The `DoltliteProduction.test.ts` suite must pass** with the changes — this is the gate. The test already simulates the correct pattern (no intermediate writes).

## Event Flow During a Turn

```
1. thread.turn-start-requested    → all projectors + immediate commit ✓
2. thread.message-sent (user)     → all projectors + immediate commit ✓
3. thread.message-sent (asst, streaming=true, NEW)  → all projectors (creates row) ✓
4. thread.message-sent (asst, streaming=true, EXISTS, <10 chunks since last save) → SKIP
5. thread.message-sent (asst, streaming=true, EXISTS, ≥10 chunks since last save) → message projector only + batch commit
6. ... repeat 4-5 ...
7. thread.message-sent (asst, streaming=false)       → all projectors + immediate commit ✓
8. thread.turn-completed           → all projectors + immediate commit ✓
```

Events 4 are skipped entirely. Events 5 write only the message text (no turn/thread/activity upserts). The counter resets when a save happens or the turn ends.

Events 4-5 are **throttled** — write to DB at most once per 10 chunks or 30 seconds, whichever comes first. This keeps crash recovery (lose at most 30s of streaming) while cutting write volume by ~90%.

**Why not skip entirely:** Turns can take 20+ minutes. If the server crashes mid-turn with no intermediate saves, the entire response is lost. If the user refreshes, they see an empty message. Periodic saves balance corruption prevention with data durability.

## File Map

- **Modify:** `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — add streaming skip in `projectEvent`, per-projector guards, batch commit for streaming
- **Modify:** `apps/server/src/persistence/Layers/DoltliteProduction.test.ts` — already matches target pattern, verify it passes
- **Test:** `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts` — add test for streaming skip behavior

---

### Task 1: Add streaming throttle in projectEvent

**Files:**
- Modify: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`

Add a counter and timestamp near `sinceLastCommit` (line ~349) to track streaming chunk frequency. In `projectEvent`, check if this is an intermediate streaming event that should be throttled.

- [ ] **Step 1: Add streaming throttle state**

Near the existing `sinceLastCommit` counter (line ~349), add:

```typescript
let streamingChunksSinceLastSave = 0;
let lastStreamingSaveMs = 0;
const STREAMING_SAVE_INTERVAL_CHUNKS = 10;
const STREAMING_SAVE_INTERVAL_MS = 30_000;
```

- [ ] **Step 2: Add the throttle guard in projectEvent**

In `projectEvent` (line ~1286), replace the existing projector loop with:

```typescript
// Throttle intermediate streaming events — save every 10 chunks or 30s.
// Initial creation (new message) and final (streaming=false) always run.
if (
  event.type === "thread.message-sent" &&
  event.payload.streaming === true
) {
  const existing = (yield* projectionThreadMessageRepository.listByThreadId({
    threadId: event.payload.threadId,
  })).find((row) => row.messageId === event.payload.messageId);

  if (existing) {
    // Message exists — this is an intermediate streaming chunk
    streamingChunksSinceLastSave++;
    const now = Date.now();
    const timeSinceLastSave = now - lastStreamingSaveMs;

    if (
      streamingChunksSinceLastSave >= STREAMING_SAVE_INTERVAL_CHUNKS ||
      timeSinceLastSave >= STREAMING_SAVE_INTERVAL_MS
    ) {
      // Periodic save — only run the message projector (skip turn/thread/activity)
      yield* runProjectorForEvent(messageProjector, event).pipe(
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(toPersistenceSqlError("ProjectionPipeline.streamingSave")(sqlError)),
        ),
      );
      streamingChunksSinceLastSave = 0;
      lastStreamingSaveMs = now;
    }
    // Skip remaining projectors — fall through to commit handler with batch semantics
  } else {
    // New message — run all projectors for initial creation
    yield* runAllProjectors(event);
    lastStreamingSaveMs = Date.now();
    streamingChunksSinceLastSave = 0;
  }
} else {
  // Non-streaming event — always run all projectors
  yield* runAllProjectors(event);
  // Reset streaming counters on turn boundaries
  if (event.type === "thread.turn-completed" || event.type === "thread.turn-start-requested") {
    streamingChunksSinceLastSave = 0;
    lastStreamingSaveMs = 0;
  }
}
```

- [ ] **Step 3: Extract runAllProjectors helper**

Above `projectEvent`, add:

```typescript
const messageProjector = projectors.find((p) => p.name === "thread-messages")!;

const runAllProjectors = (event: Parameters<typeof projectEvent>[0]) =>
  Effect.gen(function* () {
    for (const projector of projectors) {
      yield* runProjectorForEvent(projector, event).pipe(
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(
            toPersistenceSqlError(`ProjectionPipeline.projectEvent:${projector.name}`)(sqlError),
          ),
        ),
      );
    }
  });
```

- [ ] **Step 4: Verify existing tests still pass**

Run: `npx vitest run src/orchestration/Layers/ProjectionPipeline.test.ts`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/orchestration/Layers/ProjectionPipeline.ts
git commit -m "feat: throttle streaming DB writes to every 10 chunks or 30s"
```

---

### Task 2: Batch dolt_commit for streaming events

**Files:**
- Modify: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1342-1345`

Currently `thread.message-sent` sets `sinceLastCommit = 0` which forces an immediate commit. Streaming events should increment the counter and batch like `thread.activity-appended`.

- [ ] **Step 1: Change commit handler for streaming message-sent**

Replace the `thread.message-sent` case in the commit switch (around line 1342):

```typescript
case "thread.message-sent":
  if (event.payload.streaming) {
    // Streaming chunks batch like high-frequency events
    sinceLastCommit++;
    if (sinceLastCommit < 10) return;
  }
  msg = `message ${tid}`;
  sinceLastCommit = 0;
  break;
```

This means: streaming chunks count toward the batch (commit every 10). The final non-streaming event commits immediately.

- [ ] **Step 2: Verify existing tests pass**

Run: `npx vitest run src/orchestration/Layers/ProjectionPipeline.test.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/orchestration/Layers/ProjectionPipeline.ts
git commit -m "feat: batch dolt_commit for streaming events"
```

---

### Task 3: Run production test suite

**Files:**
- Test: `apps/server/src/persistence/Layers/DoltliteProduction.test.ts`

- [ ] **Step 1: Run the production simulation tests**

Run: `npx vitest run src/persistence/Layers/DoltliteProduction.test.ts`
Expected: Both tests pass (10x50 heavy session + 50x20 many-thread session)

- [ ] **Step 2: Run the integrity test suite**

Run: `npx vitest run src/persistence/Layers/DoltliteIntegrity.test.ts`
Expected: All 3 tests pass

- [ ] **Step 3: Commit test updates if any**

---

### Task 4: Manual smoke test

- [ ] **Step 1: Delete the database**

```bash
rm ~/.t3/dev/state.sqlite ~/.t3/dev/state-fts.sqlite
```

- [ ] **Step 2: Restart the server**

Kill tsx and restart: `tsx --watch src/index.ts`
Verify: migrations run, no errors

- [ ] **Step 3: Create a thread and send a message**

Open the UI, start a conversation. Verify:
- Streaming text appears in the UI (via WebSocket)
- After completion, the message is persisted (refresh the page, it's still there)
- No "database disk image is malformed" errors in server logs
- No React infinite loop errors in browser console

- [ ] **Step 4: Send 5+ messages in the same thread**

Verify the conversation persists across page refreshes.

- [ ] **Step 5: Final commit and push**

```bash
git push origin doctor-dolittle
```
