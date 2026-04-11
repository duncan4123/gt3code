import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.unsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS proj.messages_fts USING fts5(
      text,
      content=''
    )
  `);

  yield* sql`DELETE FROM proj.messages_fts`;

  yield* sql.unsafe(`
    INSERT INTO proj.messages_fts(rowid, text)
    SELECT row_id, text
    FROM proj.projection_thread_messages
  `);
});
