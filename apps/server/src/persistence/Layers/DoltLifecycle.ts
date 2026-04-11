/**
 * DoltLifecycle — explicit dolt_commit for versioned gc/beads tables.
 *
 * Only gc_beads, gc_bead_dependencies, gc_bead_labels, gc_convoys,
 * gc_convoy_members, and gc_agent_sessions are committed via dolt here.
 * The main doltlite database contains versioned metadata tables, while the
 * hot event-store, receipt, projection, and FTS tables live in the ATTACHed
 * btree sidecar.
 *
 * Commits are explicit (callers invoke doltCommit with a message), not
 * timer-based. This produces meaningful dolt_log history.
 *
 * NOTE: dolt_gc is NOT run automatically. Running GC triggered the
 * prolly_mutate.c streamingMerge bug (doltlite#247). The fix is now
 * merged but GC should still be called explicitly from admin UI only.
 */
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const GC_TABLES = [
  "gc_beads",
  "gc_bead_dependencies",
  "gc_bead_labels",
  "gc_convoys",
  "gc_convoy_members",
  "gc_agent_sessions",
] as const;

/**
 * Commit staged changes in the main (prolly) database with a descriptive message.
 * Only stages gc/beads tables. Projection, event-store, receipt, and FTS tables
 * live in `proj`.
 *
 * No-ops gracefully if not running on doltlite or if there are no changes.
 */
export const doltCommit = (message: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const isDoltlite = yield* sql.unsafe("SELECT doltlite_engine() as e").pipe(
      Effect.as(true),
      Effect.catchTag("SqlError", () => Effect.succeed(false)),
    );
    if (!isDoltlite) return;

    // Stage only the gc/beads tables
    for (const table of GC_TABLES) {
      yield* sql
        .unsafe(`SELECT dolt_add('${table}')`)
        .pipe(Effect.catchTag("SqlError", () => Effect.void));
    }

    yield* sql
      .unsafe(`SELECT dolt_commit('-m', '${message.replace(/'/g, "''")}')`)
      .pipe(Effect.catchTag("SqlError", (e) => Effect.logDebug(`dolt_commit skipped: ${e}`)));
  });

/**
 * Initialize dolt lifecycle — detect doltlite and log readiness.
 * No periodic commits; callers use doltCommit() explicitly.
 */
export const startDoltLifecycle = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const isDoltlite = yield* sql.unsafe("SELECT doltlite_engine() as e").pipe(
    Effect.as(true),
    Effect.catchTag("SqlError", () => Effect.succeed(false)),
  );

  if (!isDoltlite) {
    return;
  }

  yield* Effect.logInfo(
    "dolt lifecycle ready (explicit commit for gc/beads; hot event/projection tables in proj)",
  );
});

export const DoltLifecycleLive = Effect.void;
