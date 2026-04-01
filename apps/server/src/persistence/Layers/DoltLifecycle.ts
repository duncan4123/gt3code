/**
 * DoltLifecycle — periodic dolt_commit and dolt_gc, decoupled from the
 * projection pipeline. Runs on a timer so the pipeline stays exactly
 * as upstream wrote it (per-event sql.withTransaction, no batching).
 *
 * dolt_commit snapshots current state into the prolly tree.
 * dolt_gc compacts unreachable chunks to prevent unbounded file growth.
 */
import { Effect, Layer, Schedule } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

const COMMIT_INTERVAL_MS = 30_000; // every 30s
const GC_INTERVAL_MS = 300_000; // every 5 min

const doltCommit = Effect.fn("doltCommit")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`SELECT dolt_add('-A')`);
  yield* sql.unsafe(
    `SELECT dolt_commit('-m', '${new Date().toISOString().slice(0, 19)} auto')`,
  );
});

const doltGc = Effect.fn("doltGc")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`SELECT dolt_gc()`);
});

const makeDoltLifecycle = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Check if doltlite is active — skip entirely for plain SQLite.
  const isDoltlite = yield* sql
    .unsafe("SELECT doltlite_engine() as e")
    .pipe(
      Effect.as(true),
      Effect.catchTag("SqlError", () => Effect.succeed(false)),
    );

  if (!isDoltlite) return;

  // Periodic dolt_commit
  yield* doltCommit().pipe(
    Effect.catchTag("SqlError", (e: SqlError) =>
      Effect.logDebug(`dolt_commit skipped: ${e.message}`),
    ),
    Effect.repeat(Schedule.spaced(COMMIT_INTERVAL_MS)),
    Effect.fork,
  );

  // Periodic dolt_gc
  yield* doltGc().pipe(
    Effect.catchTag("SqlError", (e: SqlError) =>
      Effect.logDebug(`dolt_gc skipped: ${e.message}`),
    ),
    Effect.repeat(Schedule.spaced(GC_INTERVAL_MS)),
    Effect.fork,
  );
});

export const DoltLifecycleLive = Layer.effectDiscard(makeDoltLifecycle);
