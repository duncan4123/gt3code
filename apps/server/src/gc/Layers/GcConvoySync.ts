/**
 * GcConvoySyncLive — Deep integration between GC workspace state and T3
 * thread metadata. Watches GC events via SSE and reconciles bead, convoy,
 * and formula data on every relevant state change.
 *
 * Strategy: event-centric with parent lookup.
 *   1. On bead.closed/bead.updated: fetch the bead → read parentId
 *   2. If parent is a convoy: fetch convoy → update ALL threads referencing it
 *   3. Also update the specific thread assigned to the changed bead
 *   4. On convoy events: refresh convoy directly
 *
 * This works even after sessions are archived/drained — as long as a thread
 * references a convoy ID in its metadata, it will be kept in sync.
 *
 * Synced fields:
 *   Bead:   status, title, priority, assignee, labels, type, description
 *   Convoy: status, title, closedCount, totalCount, children summary
 *
 * @module GcConvoySyncLive
 */
import { Effect, Layer, Ref, Stream } from "effect";
import { CommandId } from "@t3tools/contracts";

import { GcApiClient, type GcBead, type GcConvoy, type GcEvent } from "../Services/GcApiClient.ts";
import { GcConvoySync, type GcConvoySyncShape } from "../Services/GcConvoySync.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { createLogger } from "../../logger.ts";

const log = createLogger("gc:convoy-sync");

/** Event types that can affect bead or convoy state. */
const RELEVANT_EVENTS = new Set([
  "bead.closed",
  "bead.updated",
  "bead.created",
  "bead.claimed",
  "convoy.closed",
  "convoy.updated",
  "session.archived",
  "session.drained",
]);

/** Build metadata update from a GcBead. */
function beadMetadata(bead: GcBead): Record<string, string> {
  const meta: Record<string, string> = {
    "gc.beadStatus": bead.status,
    "gc.beadTitle": bead.title,
    "gc.beadType": bead.issueType,
  };
  if (bead.priority !== undefined) meta["gc.beadPriority"] = String(bead.priority);
  if (bead.assignee) meta["gc.beadAssignee"] = bead.assignee;
  if (bead.labels && bead.labels.length > 0) meta["gc.beadLabels"] = bead.labels.join(",");
  if (bead.description) meta["gc.beadDescription"] = bead.description;
  return meta;
}

/** Build metadata update from a GcConvoy. */
function convoyMetadata(convoy: GcConvoy): Record<string, string> {
  const meta: Record<string, string> = {
    "gc.convoyStatus": convoy.status,
    "gc.convoyTitle": convoy.title,
    "gc.convoyClosedCount": String(convoy.closedCount),
    "gc.convoyTotalCount": String(convoy.totalCount),
  };
  if (convoy.children.length > 0) {
    meta["gc.convoyChildren"] = JSON.stringify(
      convoy.children.map((c) => ({ id: c.id, title: c.title, status: c.status })),
    );
  }
  return meta;
}

/** Find all thread IDs whose metadata matches a key-value pair. */
function findThreadsByMeta(
  threads: ReadonlyArray<{
    id: string;
    deletedAt: unknown;
    customMetadata?: unknown;
  }>,
  key: string,
  value: string,
): string[] {
  const result: string[] = [];
  for (const thread of threads) {
    if (thread.deletedAt !== null) continue;
    const meta = thread.customMetadata as Record<string, string> | undefined;
    if (meta?.[key] === value) result.push(thread.id);
  }
  return result;
}

const makeGcConvoySync = Effect.gen(function* () {
  const gcApi = yield* GcApiClient;
  const engine = yield* OrchestrationEngineService;
  const runningRef = yield* Ref.make(false);

  /** Dispatch a metadata update to a thread, swallowing errors. */
  const updateThreadMeta = (threadId: string, meta: Record<string, string>) =>
    engine
      .dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe(crypto.randomUUID()),
        threadId,
        customMetadata: meta,
        createdAt: new Date().toISOString(),
      })
      .pipe(
        Effect.tapError((error) =>
          Effect.sync(() =>
            log.warn(`Failed to update thread ${threadId}: ${String(error)}`),
          ),
        ),
        Effect.catch(() => Effect.void),
      );

  const syncFiber = Stream.runForEach(gcApi.streamEvents, (event: GcEvent) =>
    Effect.gen(function* () {
      if (!RELEVANT_EVENTS.has(event.type)) return;

      const readModel = yield* engine.getReadModel();
      const allThreads = readModel.threads;
      let syncCount = 0;

      // --- Bead events: subject is the bead ID ---
      if (event.type.startsWith("bead.") && event.subject) {
        const bead = yield* gcApi.getBead(event.subject).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );

        if (bead) {
          // Update threads assigned to this specific bead.
          const beadThreads = findThreadsByMeta(allThreads, "gc.bead", bead.id);
          const beadMeta = beadMetadata(bead);
          for (const threadId of beadThreads) {
            yield* updateThreadMeta(threadId, beadMeta);
            syncCount++;
          }

          // If this bead has a convoy parent, refresh convoy on ALL its threads.
          if (bead.parentId) {
            const convoy = yield* gcApi.getConvoy(bead.parentId).pipe(
              Effect.catch(() => Effect.succeed(null)),
            );
            if (convoy) {
              const cMeta = convoyMetadata(convoy);
              const convoyThreads = findThreadsByMeta(allThreads, "gc.convoy", convoy.id);
              for (const threadId of convoyThreads) {
                yield* updateThreadMeta(threadId, cMeta);
                syncCount++;
              }
              log.info(
                `Convoy ${convoy.id} (${convoy.status}, ${convoy.closedCount}/${convoy.totalCount}) synced to ${convoyThreads.length} thread(s) via bead ${bead.id}`,
              );
            }
          }
        }
      }

      // --- Convoy events: subject is the convoy ID ---
      if (event.type.startsWith("convoy.") && event.subject) {
        const convoy = yield* gcApi.getConvoy(event.subject).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        if (convoy) {
          const cMeta = convoyMetadata(convoy);
          const convoyThreads = findThreadsByMeta(allThreads, "gc.convoy", convoy.id);
          for (const threadId of convoyThreads) {
            yield* updateThreadMeta(threadId, cMeta);
            syncCount++;
          }
          log.info(
            `Convoy ${convoy.id} (${convoy.status}, ${convoy.closedCount}/${convoy.totalCount}) synced to ${convoyThreads.length} thread(s)`,
          );
        }
      }

      // --- Session events: find thread by agent and update gc.state ---
      if (
        (event.type === "session.archived" || event.type === "session.drained") &&
        event.actor
      ) {
        const agentThreads = findThreadsByMeta(allThreads, "gc.agent", event.actor);
        const stateMeta = {
          "gc.state": event.type === "session.archived" ? "archived" : "drained",
        };
        for (const threadId of agentThreads) {
          yield* updateThreadMeta(threadId, stateMeta);
          syncCount++;
        }
      }

      if (syncCount > 0) {
        log.info(
          `Synced ${syncCount} thread(s) on ${event.type}${event.subject ? ` [${event.subject}]` : ""}`,
        );
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => log.warn(`GC convoy sync error: ${String(error)}`)),
      ),
    ),
  );

  yield* Ref.set(runningRef, true);

  yield* syncFiber.pipe(Effect.ensuring(Ref.set(runningRef, false)), Effect.forkScoped);

  return {
    isRunning: Ref.get(runningRef),
  } satisfies GcConvoySyncShape;
});

export const GcConvoySyncLive = Layer.effect(GcConvoySync)(makeGcConvoySync);
