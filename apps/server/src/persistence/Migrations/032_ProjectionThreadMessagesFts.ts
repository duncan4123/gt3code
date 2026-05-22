import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_thread_messages ADD COLUMN row_id INTEGER`.pipe(
    Effect.catch(() => Effect.void),
  );

  yield* sql.unsafe(`
    UPDATE projection_thread_messages
    SET row_id = (
      SELECT COUNT(*)
      FROM projection_thread_messages AS prior
      WHERE prior.created_at < projection_thread_messages.created_at
        OR (
          prior.created_at = projection_thread_messages.created_at
          AND prior.message_id <= projection_thread_messages.message_id
        )
    )
    WHERE row_id IS NULL
  `);

  yield* sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_thread_messages_row_id
    ON projection_thread_messages(row_id)
  `);

  yield* sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text,
      content=''
    )
  `;

  yield* sql.unsafe(`
    INSERT INTO messages_fts(rowid, text)
    SELECT row_id, text
    FROM projection_thread_messages
    WHERE is_streaming = 0
      AND row_id IS NOT NULL
  `);
});
