/**
 * GcEventIngestionLive — Subscribes to GcApiClient.streamEvents and dispatches
 * thread.activity.append commands for GC-managed threads.
 *
 * Each incoming GcEvent is matched to threads whose customMetadata["gc.agent"]
 * equals the event's actor field. The event is then mapped to an
 * OrchestrationThreadActivity and dispatched through the orchestration engine.
 *
 * @module GcEventIngestionLive
 */
import { Effect, Layer, Ref, Stream } from "effect";
import { CommandId, EventId, type OrchestrationCommand } from "@t3tools/contracts";

import { GcApiClient, type GcEvent } from "../Services/GcApiClient.ts";
import { GcEventIngestion, type GcEventIngestionShape } from "../Services/GcEventIngestion.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { createLogger } from "../../logger.ts";

const log = createLogger("gc:event-ingestion");

/** Map a GcEvent.type to an activity tone. */
function gcEventTone(eventType: string): "info" | "tool" | "approval" | "error" {
  if (eventType.includes("error") || eventType.includes("fail")) return "error";
  if (eventType.includes("approval") || eventType.includes("blocked")) return "approval";
  if (eventType.includes("tool") || eventType.includes("exec") || eventType.includes("command"))
    return "tool";
  return "info";
}

/** Build a summary string from a GcEvent. */
function gcEventSummary(event: GcEvent): string {
  if (event.message) return event.message;
  const parts = [event.type];
  if (event.subject) parts.push(event.subject);
  return parts.join(": ");
}

const makeGcEventIngestion = Effect.gen(function* () {
  const gcApi = yield* GcApiClient;
  const engine = yield* OrchestrationEngineService;
  const runningRef = yield* Ref.make(false);

  const ingestFiber = Stream.runForEach(gcApi.streamEvents, (event: GcEvent) =>
    Effect.gen(function* () {
      if (!event.actor) return;

      const readModel = yield* engine.getReadModel();
      const matchingThreads = readModel.threads.filter(
        (thread) =>
          thread.deletedAt === null &&
          thread.customMetadata !== undefined &&
          (thread.customMetadata as Record<string, string>)["gc.agent"] === event.actor,
      );

      if (matchingThreads.length === 0) return;

      const nowIso = new Date().toISOString();

      for (const thread of matchingThreads) {
        const command: OrchestrationCommand = {
          type: "thread.activity.append",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId: thread.id,
          activity: {
            id: EventId.makeUnsafe(crypto.randomUUID()),
            tone: gcEventTone(event.type),
            kind: `gc.${event.type}`,
            summary: gcEventSummary(event),
            payload: {
              seq: event.seq,
              subject: event.subject ?? null,
              ...event.payload,
            },
            turnId: thread.latestTurn?.turnId ?? null,
            createdAt: event.ts || nowIso,
          },
          createdAt: nowIso,
        };

        yield* engine.dispatch(command).pipe(
          Effect.tapError((error) =>
            Effect.sync(() =>
              log.warn(`Failed to dispatch gc activity for thread ${thread.id}: ${String(error)}`),
            ),
          ),
          Effect.catch(() => Effect.void),
        );
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => log.warn(`GC event ingestion error: ${String(error)}`)),
      ),
    ),
  );

  yield* Ref.set(runningRef, true);

  yield* ingestFiber.pipe(Effect.ensuring(Ref.set(runningRef, false)), Effect.forkScoped);

  return {
    isRunning: Ref.get(runningRef),
  } satisfies GcEventIngestionShape;
});

export const GcEventIngestionLive = Layer.effect(GcEventIngestion)(makeGcEventIngestion);
