import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Move FTS5 from prolly tree to attached btree sidecar.
 *
 * Migration 017 created messages_fts + triggers in the main prolly DB.
 * FTS5 blob storage is incompatible with prolly trees, causing corruption
 * after ~100 inserts. This migration:
 *
 * 1. Drops the old triggers and FTS table from the main (prolly) DB
 * 2. Creates a content-less FTS5 table in the attached fts (btree) schema
 * 3. Backfills from projection_thread_messages
 *
 * The fts schema is ATTACHed in Sqlite.ts before migrations run.
 * Sync is handled application-level in ProjectionPipeline.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Drop old prolly-side triggers
  yield* sql`DROP TRIGGER IF EXISTS messages_fts_insert`;
  yield* sql`DROP TRIGGER IF EXISTS messages_fts_update`;
  yield* sql`DROP TRIGGER IF EXISTS messages_fts_delete`;

  // Drop old prolly-side FTS table
  yield* sql`DROP TABLE IF EXISTS messages_fts`;

  // Create FTS5 in attached btree sidecar (content-less)
  yield* sql.unsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts.messages_fts USING fts5(
      text,
      content=''
    )
  `);

  // Backfill
  yield* sql.unsafe(`
    INSERT INTO fts.messages_fts(rowid, text)
    SELECT rowid, text FROM projection_thread_messages
  `);
});
