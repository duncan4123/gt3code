/**
 * Move projection tables from main doltlite (prolly tree) to attached
 * standard SQLite sidecar (btree) for dramatically lower write overhead.
 *
 * Projection tables are materialized views rebuilt from orchestration_events
 * on startup — they don't need dolt version control. Moving them to plain
 * SQLite eliminates prolly tree overhead that caused ~20MB per dolt_commit
 * when all tables were staged.
 *
 * The `proj` schema is ATTACHed in Sqlite.ts before migrations run.
 * Unqualified table names resolve automatically since SQLite searches
 * all attached schemas.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const ensureProjectionSidecarSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
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
      branch TEXT,
      worktree_path TEXT,
      latest_turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      interaction_mode TEXT NOT NULL DEFAULT 'default',
      model_selection_json TEXT,
      custom_metadata TEXT NOT NULL DEFAULT '{}',
      archived_at TEXT,
      latest_user_message_at TEXT,
      pending_approval_count INTEGER NOT NULL DEFAULT 0,
      pending_user_input_count INTEGER NOT NULL DEFAULT 0,
      has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0
    )
  `);

  yield* sql`ALTER TABLE proj.projection_threads ADD COLUMN latest_user_message_at TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`
    ALTER TABLE proj.projection_threads
    ADD COLUMN pending_approval_count INTEGER NOT NULL DEFAULT 0
  `.pipe(Effect.catch(() => Effect.void));
  yield* sql`
    ALTER TABLE proj.projection_threads
    ADD COLUMN pending_user_input_count INTEGER NOT NULL DEFAULT 0
  `.pipe(Effect.catch(() => Effect.void));
  yield* sql`
    ALTER TABLE proj.projection_threads
    ADD COLUMN has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS proj.projection_thread_messages (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attachments_json TEXT
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
      runtime_mode TEXT NOT NULL DEFAULT 'full-access'
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
      resume_cursor_json TEXT,
      runtime_payload_json TEXT
    )
  `);

  // ── Indexes on proj tables ───────────────────────────────────────────

  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_projects_updated_at ON projection_projects(updated_at)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_projects_workspace_root_deleted_at ON projection_projects(workspace_root, deleted_at)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_threads_project_id ON projection_threads(project_id)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_threads_project_archived_at ON projection_threads(project_id, archived_at)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_threads_project_deleted_created ON projection_threads(project_id, deleted_at, created_at)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_messages_thread_created ON projection_thread_messages(thread_id, created_at)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_activities_thread_created ON projection_thread_activities(thread_id, created_at)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_activities_thread_sequence ON projection_thread_activities(thread_id, sequence)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_sessions_provider_session ON projection_thread_sessions(provider_session_id)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_turns_thread_requested ON projection_turns(thread_id, requested_at)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_turns_thread_checkpoint_completed ON projection_turns(thread_id, checkpoint_turn_count, completed_at)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_approvals_thread_status ON projection_pending_approvals(thread_id, status)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_plans_thread_created ON projection_thread_proposed_plans(thread_id, created_at)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_diff_blobs_thread_to_turn ON checkpoint_diff_blobs(thread_id, to_turn_count)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_runtime_status ON provider_session_runtime(status)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS proj.idx_proj_runtime_provider ON provider_session_runtime(provider_name)`,
  );
});

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // ── Drop old tables from main (prolly tree) ──────────────────────────

  // Drop indexes first
  yield* sql`DROP INDEX IF EXISTS idx_projection_projects_updated_at`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_projects_workspace_root_deleted_at`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_threads_project_id`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_threads_project_archived_at`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_threads_project_deleted_created`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_thread_messages_thread_created`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_thread_activities_thread_created`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_thread_activities_thread_sequence`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_thread_sessions_provider_session`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_turns_thread_requested`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_turns_thread_checkpoint_completed`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_pending_approvals_thread_status`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_thread_proposed_plans_thread_created`;
  yield* sql`DROP INDEX IF EXISTS idx_checkpoint_diff_blobs_thread_to_turn`;
  yield* sql`DROP INDEX IF EXISTS idx_provider_session_runtime_status`;
  yield* sql`DROP INDEX IF EXISTS idx_provider_session_runtime_provider`;

  // Drop tables
  yield* sql`DROP TABLE IF EXISTS projection_thread_proposed_plans`;
  yield* sql`DROP TABLE IF EXISTS projection_pending_approvals`;
  yield* sql`DROP TABLE IF EXISTS projection_turns`;
  yield* sql`DROP TABLE IF EXISTS projection_thread_sessions`;
  yield* sql`DROP TABLE IF EXISTS projection_thread_activities`;
  yield* sql`DROP TABLE IF EXISTS projection_thread_messages`;
  yield* sql`DROP TABLE IF EXISTS projection_threads`;
  yield* sql`DROP TABLE IF EXISTS projection_projects`;
  yield* sql`DROP TABLE IF EXISTS projection_state`;
  yield* sql`DROP TABLE IF EXISTS checkpoint_diff_blobs`;
  yield* sql`DROP TABLE IF EXISTS provider_session_runtime`;

  // ── Recreate in proj schema (standard SQLite btree) ──────────────────
  yield* ensureProjectionSidecarSchema;
});
