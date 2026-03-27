import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text,
      content=projection_thread_messages,
      content_rowid=rowid
    )
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS messages_fts_insert
    AFTER INSERT ON projection_thread_messages
    BEGIN
      INSERT INTO messages_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
    END
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS messages_fts_update
    AFTER UPDATE ON projection_thread_messages
    BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
      INSERT INTO messages_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
    END
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS messages_fts_delete
    AFTER DELETE ON projection_thread_messages
    BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
    END
  `;

  // Backfill existing messages into the FTS index
  yield* sql`
    INSERT INTO messages_fts(rowid, text)
    SELECT rowid, text FROM projection_thread_messages
  `;
});
