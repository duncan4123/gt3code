import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const hotTables = [
  "orchestration_events",
  "orchestration_command_receipts",
  "checkpoint_diff_blobs",
  "provider_session_runtime",
  "projection_projects",
  "projection_threads",
  "projection_thread_messages",
  "projection_thread_activities",
  "projection_thread_sessions",
  "projection_turns",
  "projection_pending_approvals",
  "projection_state",
  "projection_thread_proposed_plans",
] as const;

const mainTableExists = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly name: string }>`
      SELECT name
      FROM main.sqlite_master
      WHERE type = 'table'
        AND name = ${table}
    `;
    return rows.length > 0;
  });

const tableColumns = (schema: "main" | "proj", table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql.unsafe<{ readonly name: string }>(
      `PRAGMA ${schema}.table_info(${table})`,
    );
    return rows.map((row) => row.name);
  });

const copyIfMainExists = (table: string) =>
  Effect.gen(function* () {
    if (!(yield* mainTableExists(table))) {
      return;
    }
    const sql = yield* SqlClient.SqlClient;
    const mainColumns = yield* tableColumns("main", table);
    const projColumns = new Set(yield* tableColumns("proj", table));
    const columns = mainColumns.filter((column) => projColumns.has(column));
    if (columns.length === 0) {
      return;
    }
    const columnList = columns.map((column) => `"${column}"`).join(", ");
    yield* sql.unsafe(`
      INSERT OR IGNORE INTO proj.${table} (${columnList})
      SELECT ${columnList}
      FROM main.${table}
    `);
  });

const addColumnIfMissing = (table: string, column: string, definition: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* tableColumns("proj", table);
    if (columns.includes(column)) {
      return;
    }
    yield* sql.unsafe(`ALTER TABLE proj.${table} ADD COLUMN ${definition}`);
  });

export const ensureHotSidecarSchema = Effect.gen(function* () {
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
    CREATE TABLE IF NOT EXISTS proj.checkpoint_diff_blobs (
      thread_id TEXT NOT NULL,
      from_turn_count INTEGER NOT NULL,
      to_turn_count INTEGER NOT NULL,
      diff TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (thread_id, from_turn_count, to_turn_count)
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.provider_session_runtime (
      thread_id TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      adapter_key TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      status TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      provider_instance_id TEXT,
      resume_cursor_json TEXT,
      runtime_payload_json TEXT
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      default_model TEXT,
      scripts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      default_model_selection_json TEXT
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT,
      branch TEXT,
      worktree_path TEXT,
      latest_turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      interaction_mode TEXT NOT NULL DEFAULT 'default',
      archived_at TEXT,
      latest_user_message_at TEXT,
      pending_approval_count INTEGER NOT NULL DEFAULT 0,
      pending_user_input_count INTEGER NOT NULL DEFAULT 0,
      has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0,
      model_selection_json TEXT,
      custom_metadata TEXT NOT NULL DEFAULT '{}'
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attachments_json TEXT,
      row_id INTEGER
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_thread_activities (
      activity_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      tone TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sequence INTEGER
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_thread_sessions (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      provider_name TEXT,
      provider_session_id TEXT,
      provider_thread_id TEXT,
      active_turn_id TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      provider_instance_id TEXT
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_turns (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      pending_message_id TEXT,
      assistant_message_id TEXT,
      state TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      checkpoint_turn_count INTEGER,
      checkpoint_ref TEXT,
      checkpoint_status TEXT,
      checkpoint_files_json TEXT NOT NULL,
      source_proposed_plan_thread_id TEXT,
      source_proposed_plan_id TEXT,
      UNIQUE (thread_id, turn_id),
      UNIQUE (thread_id, checkpoint_turn_count)
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_pending_approvals (
      request_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      status TEXT NOT NULL,
      decision TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_state (
      projector TEXT PRIMARY KEY,
      last_applied_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_thread_proposed_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      plan_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      implemented_at TEXT,
      implementation_thread_id TEXT
    )
  `);

  yield* addColumnIfMissing(
    "provider_session_runtime",
    "provider_instance_id",
    "provider_instance_id TEXT",
  );
  yield* addColumnIfMissing(
    "provider_session_runtime",
    "resume_cursor_json",
    "resume_cursor_json TEXT",
  );
  yield* addColumnIfMissing(
    "provider_session_runtime",
    "runtime_payload_json",
    "runtime_payload_json TEXT",
  );
  yield* addColumnIfMissing("projection_projects", "default_model", "default_model TEXT");
  yield* addColumnIfMissing(
    "projection_projects",
    "default_model_selection_json",
    "default_model_selection_json TEXT",
  );
  yield* addColumnIfMissing("projection_threads", "model", "model TEXT");
  yield* addColumnIfMissing(
    "projection_threads",
    "runtime_mode",
    "runtime_mode TEXT NOT NULL DEFAULT 'full-access'",
  );
  yield* addColumnIfMissing(
    "projection_threads",
    "interaction_mode",
    "interaction_mode TEXT NOT NULL DEFAULT 'default'",
  );
  yield* addColumnIfMissing("projection_threads", "archived_at", "archived_at TEXT");
  yield* addColumnIfMissing(
    "projection_threads",
    "latest_user_message_at",
    "latest_user_message_at TEXT",
  );
  yield* addColumnIfMissing(
    "projection_threads",
    "pending_approval_count",
    "pending_approval_count INTEGER NOT NULL DEFAULT 0",
  );
  yield* addColumnIfMissing(
    "projection_threads",
    "pending_user_input_count",
    "pending_user_input_count INTEGER NOT NULL DEFAULT 0",
  );
  yield* addColumnIfMissing(
    "projection_threads",
    "has_actionable_proposed_plan",
    "has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0",
  );
  yield* addColumnIfMissing(
    "projection_threads",
    "model_selection_json",
    "model_selection_json TEXT",
  );
  yield* addColumnIfMissing(
    "projection_threads",
    "custom_metadata",
    "custom_metadata TEXT NOT NULL DEFAULT '{}'",
  );
  yield* addColumnIfMissing(
    "projection_thread_messages",
    "attachments_json",
    "attachments_json TEXT",
  );
  yield* addColumnIfMissing("projection_thread_messages", "row_id", "row_id INTEGER");
  yield* addColumnIfMissing("projection_thread_activities", "sequence", "sequence INTEGER");
  yield* addColumnIfMissing(
    "projection_thread_sessions",
    "runtime_mode",
    "runtime_mode TEXT NOT NULL DEFAULT 'full-access'",
  );
  yield* addColumnIfMissing(
    "projection_thread_sessions",
    "provider_instance_id",
    "provider_instance_id TEXT",
  );
  yield* addColumnIfMissing(
    "projection_turns",
    "source_proposed_plan_thread_id",
    "source_proposed_plan_thread_id TEXT",
  );
  yield* addColumnIfMissing(
    "projection_turns",
    "source_proposed_plan_id",
    "source_proposed_plan_id TEXT",
  );
  yield* addColumnIfMissing(
    "projection_thread_proposed_plans",
    "implemented_at",
    "implemented_at TEXT",
  );
  yield* addColumnIfMissing(
    "projection_thread_proposed_plans",
    "implementation_thread_id",
    "implementation_thread_id TEXT",
  );

  yield* sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS proj.idx_orch_events_stream_version
    ON orchestration_events(aggregate_kind, stream_id, stream_version)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_orch_events_stream_sequence
    ON orchestration_events(aggregate_kind, stream_id, sequence)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_orch_events_command_id ON orchestration_events(command_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_orch_events_correlation_id ON orchestration_events(correlation_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_orch_command_receipts_aggregate
    ON orchestration_command_receipts(aggregate_kind, aggregate_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_orch_command_receipts_sequence
    ON orchestration_command_receipts(result_sequence)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_checkpoint_diff_blobs_thread_to_turn
    ON checkpoint_diff_blobs(thread_id, to_turn_count)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_provider_session_runtime_status
    ON provider_session_runtime(status)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_provider_session_runtime_provider
    ON provider_session_runtime(provider_name)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_provider_session_runtime_instance
    ON provider_session_runtime(provider_instance_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_projects_updated_at ON projection_projects(updated_at)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_projects_workspace_root_deleted_at
    ON projection_projects(workspace_root, deleted_at)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_threads_project_id ON projection_threads(project_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_threads_project_archived_at
    ON projection_threads(project_id, archived_at)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_threads_project_deleted_created
    ON projection_threads(project_id, deleted_at, created_at)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_threads_shell_active
    ON projection_threads(deleted_at, archived_at, project_id, created_at, thread_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_threads_shell_archived
    ON projection_threads(deleted_at, archived_at, project_id, thread_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_thread_messages_thread_created
    ON projection_thread_messages(thread_id, created_at)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_thread_messages_thread_created_id
    ON projection_thread_messages(thread_id, created_at, message_id)
  `);
  yield* sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS proj.idx_projection_thread_messages_row_id
    ON projection_thread_messages(row_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_thread_activities_thread_created
    ON projection_thread_activities(thread_id, created_at)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_thread_activities_thread_sequence
    ON projection_thread_activities(thread_id, sequence)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_thread_activities_thread_sequence_created_id
    ON projection_thread_activities(thread_id, sequence, created_at, activity_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_thread_sessions_provider_session
    ON projection_thread_sessions(provider_session_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_thread_sessions_instance
    ON projection_thread_sessions(provider_instance_id)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_turns_thread_requested
    ON projection_turns(thread_id, requested_at)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_turns_thread_checkpoint_completed
    ON projection_turns(thread_id, checkpoint_turn_count, completed_at)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_pending_approvals_thread_status
    ON projection_pending_approvals(thread_id, status)
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS proj.idx_projection_thread_proposed_plans_thread_created
    ON projection_thread_proposed_plans(thread_id, created_at)
  `);
  yield* sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS proj.idx_projection_projects_active_workspace_root_unique
    ON projection_projects(workspace_root)
    WHERE deleted_at IS NULL
  `);
});

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* ensureHotSidecarSchema;

  for (const table of hotTables) {
    yield* copyIfMainExists(table);
  }

  yield* sql.unsafe(`DROP TABLE IF EXISTS proj.messages_fts`);
  yield* sql.unsafe(`
    CREATE VIRTUAL TABLE proj.messages_fts USING fts5(
      text,
      content=''
    )
  `);
  yield* sql.unsafe(`
    INSERT INTO proj.messages_fts(rowid, text)
    SELECT row_id, text
    FROM proj.projection_thread_messages
    WHERE is_streaming = 0
      AND row_id IS NOT NULL
  `);

  yield* sql.unsafe(`DROP TRIGGER IF EXISTS main.messages_fts_insert`);
  yield* sql.unsafe(`DROP TRIGGER IF EXISTS main.messages_fts_update`);
  yield* sql.unsafe(`DROP TRIGGER IF EXISTS main.messages_fts_delete`);
  yield* sql.unsafe(`DROP TABLE IF EXISTS main.messages_fts`);

  for (const table of hotTables) {
    yield* sql.unsafe(`DROP TABLE IF EXISTS main.${table}`);
  }
});
