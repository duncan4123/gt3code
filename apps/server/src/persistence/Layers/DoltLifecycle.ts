/**
 * DoltLifecycle — periodic dolt_commit and dolt_gc, decoupled from the
 * projection pipeline. Runs on a timer so the pipeline stays exactly
 * as upstream wrote it (per-event sql.withTransaction, no batching).
 *
 * dolt_commit snapshots current state into the prolly tree.
 * dolt_gc compacts unreachable chunks to prevent unbounded file growth.
 */
import { Data, Effect, Schedule } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { DatabaseSync } from "doltlite";

import { ServerConfig } from "../../config.ts";

const COMMIT_INTERVAL_MS = 30_000; // every 30s
const GC_INTERVAL_MS = 300_000; // every 5 min
const formatCommitMessage = () => `${new Date().toISOString().slice(0, 19)} auto`;

class DoltLifecycleError extends Data.TaggedError("DoltLifecycleError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const startDoltLifecycle = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Check if doltlite is active — skip entirely for plain SQLite.
  const isDoltlite = yield* sql.unsafe("SELECT doltlite_engine() as e").pipe(
    Effect.as(true),
    Effect.catchTag("SqlError", () => Effect.succeed(false)),
  );

  if (!isDoltlite) return;

  const { dbPath } = yield* ServerConfig;

  const makeStatementRunner =
    (db: DatabaseSync) =>
    (sqlText: string, params: ReadonlyArray<unknown> = []) =>
      Effect.try({
        try: () => {
          const statement = db.prepare(sqlText);
          if (statement.columns().length > 0) {
            statement.get(...(params as any));
          } else {
            statement.run(...(params as any));
          }
        },
        catch: (cause) =>
          new DoltLifecycleError({
            message: `Failed to execute Dolt lifecycle statement: ${sqlText}`,
            cause,
          }),
      });

  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new DatabaseSync(dbPath)),
    (db) =>
      Effect.gen(function* () {
        const exec = makeStatementRunner(db);

        // Periodic dolt_commit (dedicated connection avoids blocking user queries)
        yield* Effect.forkScoped(
          Effect.gen(function* () {
            yield* exec("SELECT dolt_add('-A')");
            yield* exec("SELECT dolt_commit('-m', ?)", [formatCommitMessage()]);
          }).pipe(
            Effect.catchTag("DoltLifecycleError", (error) =>
              Effect.logDebug(`dolt_commit skipped: ${error.message}`),
            ),
            Effect.repeat(Schedule.spaced(COMMIT_INTERVAL_MS)),
          ),
        );

        // Periodic dolt_gc
        yield* Effect.forkScoped(
          exec("SELECT dolt_gc()").pipe(
            Effect.catchTag("DoltLifecycleError", (error) =>
              Effect.logDebug(`dolt_gc skipped: ${error.message}`),
            ),
            Effect.repeat(Schedule.spaced(GC_INTERVAL_MS)),
          ),
        );

        yield* Effect.logInfo("dolt lifecycle started (commit: 30s, gc: 5min)");
        return yield* Effect.never;
      }),
    (db) => Effect.sync(() => db.close()),
  );
});
