/**
 * DoltLifecycle — periodic dolt_commit and dolt_gc on the main SqlClient.
 *
 * Uses the same connection as the pipeline so Dolt maintenance stays
 * serialized with runtime writes.
 */
import { Effect, Layer, Schedule } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProviderService } from "../../provider/Services/ProviderService.ts";

const COMMIT_INTERVAL_MS = 30_000;
const GC_INTERVAL_MS = 300_000;

export const startDoltLifecycle = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const providerService = yield* ProviderService;

  const isDoltlite = yield* sql.unsafe("SELECT doltlite_engine() as e").pipe(
    Effect.as(true),
    Effect.catchTag("SqlError", () => Effect.succeed(false)),
  );

  if (!isDoltlite) {
    return;
  }

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      yield* sql.unsafe(`SELECT dolt_add('-A')`);
      yield* sql.unsafe(
        `SELECT dolt_commit('-m', '${new Date().toISOString().slice(0, 19)} auto')`,
      );
    }).pipe(
      Effect.catch((error) => Effect.logDebug(`dolt_commit skipped: ${error}`)),
      Effect.repeat(Schedule.spaced(COMMIT_INTERVAL_MS)),
    ),
  );

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const sessions = yield* providerService.listSessions();
      const hasActiveTurn = sessions.some((session) => session.activeTurnId !== undefined);
      if (hasActiveTurn) {
        yield* Effect.logDebug("dolt_gc skipped: active turns still running");
        return;
      }

      yield* sql.unsafe(`SELECT dolt_gc()`);
    }).pipe(
      Effect.catch((error) => Effect.logDebug(`dolt_gc skipped: ${error}`)),
      Effect.repeat(Schedule.spaced(GC_INTERVAL_MS)),
    ),
  );

  yield* Effect.logInfo("dolt lifecycle started (commit: 30s, gc: 5min)");
});

export const DoltLifecycleLive = Layer.effectDiscard(startDoltLifecycle);
