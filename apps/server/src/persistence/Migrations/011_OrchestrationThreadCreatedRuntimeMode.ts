import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Backfill runtimeMode into thread.created payloads that predate the field.
  // json_set/json_type not available in doltlite — manipulate JSON at app layer.
  const rows = yield* sql<{ sequence: number; payload_json: string }>`
    SELECT sequence, payload_json
    FROM orchestration_events
    WHERE event_type = 'thread.created'
  `;

  for (const row of rows) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (payload["runtimeMode"] == null) {
      payload["runtimeMode"] = "full-access";
      yield* sql`
        UPDATE orchestration_events
        SET payload_json = ${JSON.stringify(payload)}
        WHERE sequence = ${row.sequence}
      `;
    }
  }
});
