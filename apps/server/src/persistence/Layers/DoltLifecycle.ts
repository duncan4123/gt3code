/**
 * DoltLifecycle — periodic dolt_commit on the main SqlClient.
 *
 * Uses the same connection as the pipeline so Dolt maintenance stays
 * serialized with runtime writes.
 *
 * NOTE: dolt_gc is NOT run automatically. GC cleans up unreachable chunks
 * from branch operations, which don't apply to our linear single-branch
 * usage. Running GC triggered the prolly_mutate.c streamingMerge bug
 * (doltlite#247), corrupting the event store. Call GC explicitly from
 * settings/admin UI only when needed (e.g. after branch cleanup).
 */
import { Effect, Layer, Schedule } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const COMMIT_INTERVAL_MS = 5_000;

// Only commit the event store and command receipts — these are the
// source of truth. Projection tables are rebuilt from events on startup
// and don't need version history. Staging all tables with dolt_add('-A')
// costs ~20MB per commit in prolly tree overhead vs ~1KB for selective add.
// Individual commits are ~6x cheaper per row than batched commits because
// less prolly tree structure needs rehashing.
const COMMIT_TABLES = ["orchestration_events", "orchestration_command_receipts"] as const;

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
      for (const table of COMMIT_TABLES) {
        yield* sql.unsafe(`SELECT dolt_add('${table}')`);
      }
      yield* sql.unsafe(
        `SELECT dolt_commit('-m', '${new Date().toISOString().slice(0, 19)} auto')`,
      );
    }).pipe(
      Effect.catch((error) => Effect.logDebug(`dolt_commit skipped: ${error}`)),
      Effect.repeat(Schedule.spaced(COMMIT_INTERVAL_MS)),
    ),
  );

  yield* Effect.logInfo("dolt lifecycle started (commit: 5s, selective)");
});

export const DoltLifecycleLive = Layer.effectDiscard(startDoltLifecycle);
