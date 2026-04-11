/**
 * Create gc/beads lookup tables in main (prolly) for versioned tracking.
 *
 * Event store tables (orchestration_events, orchestration_command_receipts)
 * stay in main for now — cross-schema INSERT from prolly → btree causes
 * SIGSEGV in doltlite. They'll move to proj in a future migration once
 * the cross-schema data copy path is tested.
 *
 * After this migration:
 * - Projection tables live in proj (btree) — from migration 021
 * - Event store tables stay in main (prolly) — existing behavior
 * - New gc/beads lookup tables in main (prolly) for dolt versioning
 * - Cross-schema joins via thread_id / issue_id work natively
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // ── Create gc/beads lookup tables in main (prolly, versioned) ──────

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS gc_beads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority INTEGER NOT NULL DEFAULT 2,
      issue_type TEXT NOT NULL DEFAULT 'task',
      assignee TEXT,
      epic_parent_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    )
  `);
  yield* sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_gc_beads_status ON gc_beads(status)`);
  yield* sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_gc_beads_assignee ON gc_beads(assignee)`);
  yield* sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_gc_beads_epic ON gc_beads(epic_parent_id)`);
  yield* sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_gc_beads_type ON gc_beads(issue_type)`);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS gc_bead_dependencies (
      issue_id TEXT NOT NULL,
      depends_on_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'blocks',
      PRIMARY KEY (issue_id, depends_on_id)
    )
  `);
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_gc_bead_deps_depends_on ON gc_bead_dependencies(depends_on_id)`,
  );

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS gc_bead_labels (
      issue_id TEXT NOT NULL,
      label TEXT NOT NULL,
      PRIMARY KEY (issue_id, label)
    )
  `);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS gc_convoys (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      formula TEXT,
      scope_kind TEXT,
      scope_ref TEXT,
      closed_count INTEGER NOT NULL DEFAULT 0,
      total_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  yield* sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_gc_convoys_status ON gc_convoys(status)`);

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS gc_convoy_members (
      convoy_id TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      thread_id TEXT,
      agent TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      PRIMARY KEY (convoy_id, issue_id)
    )
  `);
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_gc_convoy_members_thread ON gc_convoy_members(thread_id)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_gc_convoy_members_issue ON gc_convoy_members(issue_id)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_gc_convoy_members_status ON gc_convoy_members(status)`,
  );

  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS gc_agent_sessions (
      thread_id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      rig TEXT,
      city TEXT,
      bead_id TEXT,
      molecule TEXT,
      formula TEXT,
      state TEXT NOT NULL DEFAULT 'active',
      updated_at TEXT NOT NULL
    )
  `);
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_gc_agent_sessions_agent ON gc_agent_sessions(agent)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_gc_agent_sessions_bead ON gc_agent_sessions(bead_id)`,
  );
  yield* sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_gc_agent_sessions_state ON gc_agent_sessions(state)`,
  );
});
