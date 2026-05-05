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
    UPDATE proj.projection_thread_sessions
    SET provider_instance_id = provider_name
    WHERE provider_instance_id IS NULL
      AND provider_name IS NOT NULL
  `);
});
