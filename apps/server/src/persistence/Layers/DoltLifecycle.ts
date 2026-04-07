/**
 * DoltLifecycle — periodic dolt_commit for versioned tables.
 *
 * Only orchestration_events and orchestration_command_receipts live in the
 * main doltlite database. All projection tables are in an ATTACHed standard
 * SQLite sidecar (proj schema) and are not versioned.
 *
 * NOTE: dolt_gc is NOT run automatically. Running GC triggered the
 * prolly_mutate.c streamingMerge bug (doltlite#247), corrupting the
 * event store.
 */
import { Effect, Layer, Schedule } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const COMMIT_INTERVAL_MS = 5 * 60_000; // 5 minutes

export const startDoltLifecycle = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const isDoltlite = yield* sql.unsafe("SELECT doltlite_engine() as e").pipe(
    Effect.as(true),
    Effect.catchTag("SqlError", () => Effect.succeed(false)),
  );

  if (!isDoltlite) {
    return;
  }

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      yield* sql.unsafe("SELECT dolt_add('-A')");
      yield* sql.unsafe(
        `SELECT dolt_commit('-m', '${new Date().toISOString().slice(0, 19)} auto')`,
      );
    }).pipe(
      Effect.catch((error) => Effect.logDebug(`dolt_commit skipped: ${error}`)),
      Effect.repeat(Schedule.spaced(COMMIT_INTERVAL_MS)),
    ),
  );

  yield* Effect.logInfo("dolt lifecycle started (commit: 5m, event store only)");
});

export const DoltLifecycleLive = Layer.effectDiscard(startDoltLifecycle);
