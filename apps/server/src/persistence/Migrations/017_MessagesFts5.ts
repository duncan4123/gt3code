import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * FTS5 full-text search index for conversation messages.
 *
 * The FTS5 virtual table lives in the attached `fts` schema (standard SQLite
 * btree file) because doltlite's prolly-tree storage corrupts FTS5 blob
 * storage after ~100 inserts. The btree sidecar is attached in Sqlite.ts
 * before migrations run.
 *
 * Sync is application-level (ProjectionPipeline), not trigger-based, because
 * SQLite forbids qualified table names in trigger INSERT/UPDATE/DELETE.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // FTS5 virtual table in the attached btree database.
  // content-less — the projector syncs rows after each message upsert/delete.
  yield* sql.unsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts.messages_fts USING fts5(
      text,
      content=''
    )
  `);

  // Backfill existing messages into the FTS index
  yield* sql.unsafe(`
    INSERT INTO fts.messages_fts(rowid, text)
    SELECT rowid, text FROM projection_thread_messages
  `);
});
