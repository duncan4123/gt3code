import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * FTS5 full-text search index for conversation messages.
 *
 * Content-less — the projector syncs rows after each message upsert/delete.
 * Lives in the main doltlite database (prolly tree). If corruption occurs,
 * move to an ATTACH btree sidecar.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.unsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text,
      content=''
    )
  `);

  // Backfill existing messages
  yield* sql.unsafe(`
    INSERT INTO messages_fts(rowid, text)
    SELECT rowid, text FROM projection_thread_messages
  `);
});
