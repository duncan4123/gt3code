import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA proj.table_info(projection_thread_sessions)
  `;
  if (!columns.some((column) => column.name === "provider_instance_id")) {
    yield* sql`
      ALTER TABLE proj.projection_thread_sessions
      ADD COLUMN provider_instance_id TEXT
    `;
  }

  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_thread_sessions_instance
    ON projection_thread_sessions(provider_instance_id)
  `);
});
