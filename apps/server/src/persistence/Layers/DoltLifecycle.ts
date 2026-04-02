/**
 * DoltLifecycle — periodic dolt_commit and dolt_gc on the main SqlClient.
 *
 * Uses the same connection as the pipeline (required by doltlite — GC
 * must run on the connection that did the commits, not a separate one).
 *
 * dolt_commit snapshots current state into the prolly tree.
 * dolt_gc compacts unreachable chunks to prevent unbounded file growth.
 */
import { Effect, Schedule } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProviderService } from "../../provider/Services/ProviderService.ts";

const COMMIT_INTERVAL_MS = 30_000; // every 30s
const GC_INTERVAL_MS = 300_000; // every 5 min

export const startDoltLifecycle = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const providerService = yield* ProviderService;

  // Check if doltlite is active — skip entirely for plain SQLite.
  const isDoltlite = yield* sql.unsafe("SELECT doltlite_engine() as e").pipe(
    Effect.as(true),
    Effect.catchTag("SqlError", () => Effect.succeed(false)),
  );

  if (!isDoltlite) return;

  // Periodic dolt_commit
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      yield* sql.unsafe(`SELECT dolt_add('-A')`);
      yield* sql.unsafe(
        `SELECT dolt_commit('-m', '${new Date().toISOString().slice(0, 19)} auto')`,
      );
    }).pipe(
      Effect.catch((e) => Effect.logDebug(`dolt_commit skipped: ${e}`)),
      Effect.repeat(Schedule.spaced(COMMIT_INTERVAL_MS)),
    ),
  );

  // Periodic dolt_gc — same connection, serialized by the SqlClient semaphore.
  // Blocks briefly but avoids the "out of memory" error from concurrent connections.
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
      Effect.catch((e) => Effect.logDebug(`dolt_gc skipped: ${e}`)),
      Effect.repeat(Schedule.spaced(GC_INTERVAL_MS)),
    ),
  );

  yield* Effect.logInfo("dolt lifecycle started (commit: 30s, gc: 5min)");
});
