import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_projects_active_workspace_root_unique
    ON projection_projects(workspace_root)
    WHERE deleted_at IS NULL
  `;
});
