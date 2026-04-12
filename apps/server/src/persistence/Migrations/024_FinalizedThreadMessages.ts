import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS finalized_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      attachments_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_finalized_thread_messages_thread_created
    ON finalized_thread_messages(thread_id, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_finalized_thread_messages_turn
    ON finalized_thread_messages(turn_id)
  `;

  yield* sql.unsafe(`
    INSERT INTO finalized_thread_messages (
      message_id,
      thread_id,
      turn_id,
      role,
      text,
      attachments_json,
      created_at,
      updated_at
    )
    SELECT
      message_id,
      thread_id,
      turn_id,
      role,
      text,
      attachments_json,
      created_at,
      updated_at
    FROM proj.projection_thread_messages
    WHERE is_streaming = 0
    ON CONFLICT (message_id)
    DO UPDATE SET
      thread_id = excluded.thread_id,
      turn_id = excluded.turn_id,
      role = excluded.role,
      text = excluded.text,
      attachments_json = excluded.attachments_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
});
