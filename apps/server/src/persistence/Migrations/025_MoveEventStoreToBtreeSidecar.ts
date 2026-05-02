import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const ensureEventStoreSidecarSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.orchestration_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      aggregate_kind TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      command_id TEXT,
      causation_event_id TEXT,
      correlation_id TEXT,
      actor_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.orchestration_command_receipts (
      command_id TEXT PRIMARY KEY,
      aggregate_kind TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      result_sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    )
  `);

  yield* sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS proj.idx_orch_events_stream_version
    ON orchestration_events(aggregate_kind, stream_id, stream_version)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_orch_events_stream_sequence
    ON orchestration_events(aggregate_kind, stream_id, sequence)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_orch_events_command_id
    ON orchestration_events(command_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_orch_events_correlation_id
    ON orchestration_events(correlation_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_orch_command_receipts_aggregate
    ON orchestration_command_receipts(aggregate_kind, aggregate_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_orch_command_receipts_sequence
    ON orchestration_command_receipts(result_sequence)
  `);
});

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* ensureEventStoreSidecarSchema;

  yield* sql.unsafe(`
    INSERT OR IGNORE INTO proj.orchestration_events (
      sequence,
      event_id,
      aggregate_kind,
      stream_id,
      stream_version,
      event_type,
      occurred_at,
      command_id,
      causation_event_id,
      correlation_id,
      actor_kind,
      payload_json,
      metadata_json
    )
    SELECT
      sequence,
      event_id,
      aggregate_kind,
      stream_id,
      stream_version,
      event_type,
      occurred_at,
      command_id,
      causation_event_id,
      correlation_id,
      actor_kind,
      payload_json,
      metadata_json
    FROM orchestration_events
  `);

  yield* sql.unsafe(`
    INSERT OR IGNORE INTO proj.orchestration_command_receipts (
      command_id,
      aggregate_kind,
      aggregate_id,
      accepted_at,
      result_sequence,
      status,
      error
    )
    SELECT
      command_id,
      aggregate_kind,
      aggregate_id,
      accepted_at,
      result_sequence,
      status,
      error
    FROM orchestration_command_receipts
  `);

  yield* sql`DROP INDEX IF EXISTS idx_orch_events_stream_version`;
  yield* sql`DROP INDEX IF EXISTS idx_orch_events_stream_sequence`;
  yield* sql`DROP INDEX IF EXISTS idx_orch_events_command_id`;
  yield* sql`DROP INDEX IF EXISTS idx_orch_events_correlation_id`;
  yield* sql`DROP INDEX IF EXISTS idx_orch_command_receipts_aggregate`;
  yield* sql`DROP INDEX IF EXISTS idx_orch_command_receipts_sequence`;

  yield* sql`DROP TABLE IF EXISTS orchestration_events`;
  yield* sql`DROP TABLE IF EXISTS orchestration_command_receipts`;
});
