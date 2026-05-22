import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.unsafe(`DROP TRIGGER IF EXISTS messages_fts_insert`);
  yield* sql.unsafe(`DROP TRIGGER IF EXISTS messages_fts_update`);
  yield* sql.unsafe(`DROP TRIGGER IF EXISTS messages_fts_delete`);
  yield* sql.unsafe(`DROP TABLE IF EXISTS messages_fts`);

  yield* sql.unsafe(`
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      text,
      content=''
    )
  `);

  yield* sql.unsafe(`
    INSERT INTO messages_fts(rowid, text)
    SELECT rowid, text
    FROM projection_thread_messages
    WHERE is_streaming = 0
  `);
});
