/**
 * DoltliteProduction — Tests that simulate real t3code server write patterns.
 *
 * These tests exist because doltlite has bugs in its prolly-tree index
 * handling that cause data loss during normal operation. The bugs only
 * manifest at certain data volumes with specific multi-table write
 * patterns — exactly what the server does during real conversations.
 *
 * If these tests pass, the server should be safe to use without losing
 * conversation history. If they fail, DO NOT run the server.
 *
 * Known bugs tracked at: https://github.com/timsehn/doltlite/issues/205
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require_ = createRequire(resolve(import.meta.dirname, "../../../package.json"));
const Database = require_("better-sqlite3") as new (f: string) => any;

/** Create a fresh doltlite database with the exact production schema. */
function createProductionDb() {
  const dir = mkdtempSync(join(tmpdir(), "t3-prod-"));
  const dbPath = join(dir, "state.sqlite");
  const ftsPath = join(dir, "state-fts.sqlite");
  execSync(`sqlite3 ${JSON.stringify(ftsPath)} "CREATE TABLE _seed(x INTEGER); DROP TABLE _seed;"`);

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(`ATTACH DATABASE '${ftsPath}' AS fts`);

  // Exact schemas from migrations 001-019
  db.exec(`CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY)`);

  db.exec(`
    CREATE TABLE orchestration_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      aggregate_kind TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      command_id TEXT,
      causation_event_id TEXT,
      correlation_id TEXT,
      actor_kind TEXT,
      payload_json TEXT NOT NULL,
      metadata_json TEXT
    )
  `);
  db.exec(`CREATE UNIQUE INDEX idx_orch_events_event_id ON orchestration_events(event_id)`);
  db.exec(`CREATE INDEX idx_orch_events_stream_sequence ON orchestration_events(stream_id, stream_version)`);

  db.exec(`
    CREATE TABLE orchestration_command_receipts (
      command_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    )
  `);

  db.exec(`CREATE TABLE checkpoint_diff_blobs (hash TEXT PRIMARY KEY, data BLOB NOT NULL)`);

  db.exec(`
    CREATE TABLE provider_session_runtime (
      session_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'code',
      started_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);

  db.exec(`
    CREATE TABLE projection_projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT,
      runtime_mode TEXT NOT NULL DEFAULT 'code',
      interaction_mode TEXT NOT NULL DEFAULT 'conversation',
      custom_metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attachments_json TEXT
    )
  `);
  db.exec(`CREATE INDEX idx_projection_thread_messages_thread ON projection_thread_messages(thread_id, created_at)`);

  db.exec(`
    CREATE TABLE projection_thread_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX idx_projection_thread_activities_thread_sequence ON projection_thread_activities(thread_id, sequence)`);
  db.exec(`CREATE INDEX idx_projection_thread_activities_thread_created ON projection_thread_activities(thread_id, created_at)`);

  db.exec(`
    CREATE TABLE projection_thread_sessions (
      session_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'code',
      started_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE projection_turns (
      turn_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      pending_message_id TEXT,
      source_proposed_plan_thread_id TEXT,
      source_proposed_plan_id TEXT,
      assistant_message_id TEXT,
      state TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      checkpoint_files TEXT NOT NULL DEFAULT '[]'
    )
  `);
  db.exec(`CREATE INDEX idx_projection_turns_thread ON projection_turns(thread_id, requested_at)`);

  db.exec(`CREATE TABLE projection_pending_approvals (approval_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`);

  db.exec(`CREATE TABLE projection_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  db.exec(`CREATE TABLE projection_thread_proposed_plans (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, title TEXT, status TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, implementation_thread_id TEXT)`);

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS fts.messages_fts USING fts5(text, content='')`);

  try {
    db.prepare("SELECT dolt_add('-A')").get();
    db.prepare("SELECT dolt_commit('-m', 'schema')").get();
  } catch {}

  return {
    db,
    dir,
    ftsPath,
    cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

/** Verify all rows in a table can be found via each index. */
function verifyIndexIntegrity(db: any, table: string, indexes: string[]): string[] {
  const tableCount = db.prepare(`SELECT count(*) as n FROM "${table}"`).get().n;
  const errors: string[] = [];
  for (const idx of indexes) {
    try {
      const idxCount = db.prepare(`SELECT count(*) as n FROM "${table}" INDEXED BY "${idx}" WHERE 1=1`).get().n;
      if (idxCount !== tableCount) {
        errors.push(`${idx}: ${idxCount}/${tableCount} rows via index scan`);
      }
    } catch (e: any) {
      errors.push(`${idx}: ${e.message}`);
    }
  }
  return errors;
}

/** Simulate a complete conversation turn. */
function simulateTurn(
  db: any,
  stmts: Record<string, any>,
  threadId: string,
  turnN: number,
  eventSeq: { n: number },
  activitySeq: { n: number },
) {
  const ts = new Date(Date.now() + eventSeq.n * 100).toISOString();
  const turnId = `turn-${threadId}-${turnN}`;

  // 1. Turn requested (orchestration event + pending turn)
  stmts.insEvent.run(
    `evt-${eventSeq.n++}`, "thread", threadId, turnN * 4,
    "thread.turn-start-requested", ts,
    JSON.stringify({ turnId, threadId }),
  );
  stmts.upsertTurn.run(turnId, threadId, null, null, null, null, "pending", ts);

  // 2. User message — varied lengths like real prompts
  const userMsgId = `msg-${threadId}-${turnN}-user`;
  const userTexts = [
    "Fix the bug in the auth handler",
    "Can you refactor this function to use async/await instead of callbacks? The current implementation has deeply nested callbacks that are hard to follow.",
    `Here's the error I'm getting:\n\`\`\`\nTypeError: Cannot read properties of undefined (reading 'map')\n    at processItems (src/handlers/items.ts:${42 + turnN}:15)\n    at async Router.handle (src/router.ts:89:5)\n\`\`\`\nIt happens when the API returns an empty response.`,
    "Add comprehensive error handling to the database layer. Each query should catch connection errors, timeout errors, and constraint violations separately. Log the error details and return appropriate HTTP status codes.",
    `I need to add a new endpoint \`POST /api/v2/projects/:id/deploy\` that:\n1. Validates the project exists\n2. Checks the user has deploy permissions\n3. Creates a deployment record\n4. Triggers the CI pipeline via webhook\n5. Returns the deployment ID\n\nUse the existing patterns from the other endpoints in \`src/routes/projects.ts\`.`,
  ];
  const userText = userTexts[turnN % userTexts.length];
  stmts.insEvent.run(
    `evt-${eventSeq.n++}`, "thread", threadId, turnN * 4 + 1,
    "thread.message-appended", ts,
    JSON.stringify({ messageId: userMsgId, role: "user", text: userText }),
  );
  stmts.upsertMessage.run(userMsgId, threadId, turnId, "user", userText, 0, ts, ts, null);
  stmts.insActivity.run(threadId, activitySeq.n++, "message-appended", ts);

  // 3. Assistant response (streaming start)
  const asstMsgId = `msg-${threadId}-${turnN}-asst`;
  stmts.insEvent.run(
    `evt-${eventSeq.n++}`, "thread", threadId, turnN * 4 + 2,
    "thread.message-appended", ts,
    JSON.stringify({ messageId: asstMsgId, role: "assistant", text: "" }),
  );
  stmts.upsertMessage.run(asstMsgId, threadId, turnId, "assistant", "", 1, ts, ts, null);
  stmts.insActivity.run(threadId, activitySeq.n++, "message-appended", ts);

  // 4. Streaming updates — variable chunk sizes like real LLM responses
  const numChunks = 3 + (turnN % 12); // 3-14 chunks per turn
  let accumulated = "";
  for (let chunk = 0; chunk < numChunks; chunk++) {
    // Vary chunk size: short reasoning, medium text, long code blocks
    const kind = chunk % 3;
    let addition: string;
    if (kind === 0) {
      // Short reasoning chunk (~50-200 chars)
      addition = `Let me think about this. ${turnN % 2 === 0 ? "The issue is in the handler." : "I'll check the configuration first."} `;
    } else if (kind === 1) {
      // Medium explanation chunk (~200-800 chars)
      addition = `Here's what I found: the function \`process${turnN}Handler\` on line ${100 + turnN * 3} has a bug where it doesn't handle the edge case when the input array is empty. The fix is to add a guard clause at the top of the function. `.repeat(1 + (chunk % 3));
    } else {
      // Large code block chunk (~500-3000 chars)
      const lines = 5 + (chunk * 3) + (turnN % 7);
      addition = "```typescript\n" + Array.from({ length: lines }, (_, i) =>
        `  ${i === 0 ? "export" : ""} const ${i === 0 ? "result" : `step${i}`} = ${i === 0 ? "await pipeline(" : `transform${i}(`}${i > 0 ? `step${i - 1}` : "input"}, { timeout: ${1000 + i * 100}, retries: ${i % 3}, metadata: ${JSON.stringify({ turn: turnN, chunk, line: i })} });`
      ).join("\n") + "\n```\n";
    }
    accumulated += addition;
    stmts.upsertMessage.run(asstMsgId, threadId, turnId, "assistant", accumulated, 1, ts, ts, null);
    stmts.insActivity.run(threadId, activitySeq.n++, "message-updated", ts);
  }

  // 5. Turn completed — final response is the full accumulated text
  stmts.insEvent.run(
    `evt-${eventSeq.n++}`, "thread", threadId, turnN * 4 + 3,
    "thread.turn-completed", ts,
    JSON.stringify({ turnId }),
  );
  stmts.upsertMessage.run(asstMsgId, threadId, turnId, "assistant", accumulated, 0, ts, ts, null);
  stmts.upsertTurn.run(turnId, threadId, userMsgId, null, null, asstMsgId, "completed", ts);
  stmts.insActivity.run(threadId, activitySeq.n++, "turn-completed", ts);
}

describe("doltlite production simulation", () => {
  it("survives 10 threads with 50 turns each (heavy session)", { timeout: 300_000 }, () => {
    const { db, cleanup } = createProductionDb();
    try {
      const stmts = {
        insEvent: db.prepare(`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, payload_json) VALUES (?,?,?,?,?,?,?)`),
        upsertThread: db.prepare(`INSERT OR REPLACE INTO projection_threads (thread_id, project_id, title, created_at, updated_at) VALUES (?,?,?,?,?)`),
        upsertMessage: db.prepare(`INSERT OR REPLACE INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at, attachments_json) VALUES (?,?,?,?,?,?,?,?,?)`),
        insActivity: db.prepare(`INSERT INTO projection_thread_activities (thread_id, sequence, kind, created_at) VALUES (?,?,?,?)`),
        upsertTurn: db.prepare(`INSERT OR REPLACE INTO projection_turns (turn_id, thread_id, pending_message_id, source_proposed_plan_thread_id, source_proposed_plan_id, assistant_message_id, state, requested_at) VALUES (?,?,?,?,?,?,?,?)`),
        insReceipt: db.prepare(`INSERT OR REPLACE INTO orchestration_command_receipts (command_id, event_id, occurred_at) VALUES (?,?,?)`),
      };

      const eventSeq = { n: 0 };
      const activitySeq = { n: 0 };
      let commitN = 0;

      for (let t = 0; t < 10; t++) {
        const threadId = `thread-${t}`;
        const ts = new Date().toISOString();
        stmts.upsertThread.run(threadId, "project-1", `Conversation ${t}`, ts, ts);

        for (let turn = 0; turn < 50; turn++) {
          simulateTurn(db, stmts, threadId, turn, eventSeq, activitySeq);

          // dolt_commit every 10 events (matches server batch logic)
          if (eventSeq.n % 10 === 0) {
            commitN++;
            try {
              db.prepare("SELECT dolt_add('-A')").get();
              db.prepare("SELECT dolt_commit('-m', 'batch')").get();
            } catch {}
          }
        }

        // Verify after each thread — catches corruption early
        const errors = [
          ...verifyIndexIntegrity(db, "projection_thread_activities", [
            "idx_projection_thread_activities_thread_sequence",
            "idx_projection_thread_activities_thread_created",
          ]),
          ...verifyIndexIntegrity(db, "orchestration_events", [
            "idx_orch_events_stream_sequence",
          ]),
          ...verifyIndexIntegrity(db, "projection_thread_messages", [
            "idx_projection_thread_messages_thread",
          ]),
          ...verifyIndexIntegrity(db, "projection_turns", [
            "idx_projection_turns_thread",
          ]),
        ];
        expect(errors, `Thread ${t} (${eventSeq.n} events, ${commitN} commits)`).toEqual([]);
      }

      // Final point lookup verification — query every row by its actual values
      const totalActivities = db.prepare("SELECT count(*) as n FROM projection_thread_activities").get().n;
      const allRows = db.prepare("SELECT thread_id, sequence FROM projection_thread_activities").all();
      let pointHits = 0;
      for (const row of allRows) {
        const found = db.prepare("SELECT id FROM projection_thread_activities WHERE thread_id = ? AND sequence = ?").get(row.thread_id, row.sequence);
        if (found) pointHits++;
      }
      expect(pointHits, `Point lookups: ${pointHits}/${totalActivities}`).toBe(totalActivities);

      console.error(`[prod-test] 10 threads x 50 turns: ${eventSeq.n} events, ${activitySeq.n} activities, ${commitN} commits, ${pointHits}/${totalActivities} lookups OK`);
    } finally {
      cleanup();
    }
  });

  it("survives 50 threads with 20 turns each (many-thread session)", { timeout: 300_000 }, () => {
    const { db, cleanup } = createProductionDb();
    try {
      const stmts = {
        insEvent: db.prepare(`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, payload_json) VALUES (?,?,?,?,?,?,?)`),
        upsertThread: db.prepare(`INSERT OR REPLACE INTO projection_threads (thread_id, project_id, title, created_at, updated_at) VALUES (?,?,?,?,?)`),
        upsertMessage: db.prepare(`INSERT OR REPLACE INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at, attachments_json) VALUES (?,?,?,?,?,?,?,?,?)`),
        insActivity: db.prepare(`INSERT INTO projection_thread_activities (thread_id, sequence, kind, created_at) VALUES (?,?,?,?)`),
        upsertTurn: db.prepare(`INSERT OR REPLACE INTO projection_turns (turn_id, thread_id, pending_message_id, source_proposed_plan_thread_id, source_proposed_plan_id, assistant_message_id, state, requested_at) VALUES (?,?,?,?,?,?,?,?)`),
        insReceipt: db.prepare(`INSERT OR REPLACE INTO orchestration_command_receipts (command_id, event_id, occurred_at) VALUES (?,?,?)`),
      };

      const eventSeq = { n: 0 };
      const activitySeq = { n: 0 };

      for (let t = 0; t < 50; t++) {
        const threadId = `thread-${t}`;
        const ts = new Date().toISOString();
        stmts.upsertThread.run(threadId, "project-1", `Thread ${t}`, ts, ts);

        for (let turn = 0; turn < 20; turn++) {
          simulateTurn(db, stmts, threadId, turn, eventSeq, activitySeq);
          if (eventSeq.n % 10 === 0) {
            try {
              db.prepare("SELECT dolt_add('-A')").get();
              db.prepare("SELECT dolt_commit('-m', 'batch')").get();
            } catch {}
          }
        }
      }

      // Full verification
      const tables = [
        { name: "projection_thread_activities", indexes: ["idx_projection_thread_activities_thread_sequence", "idx_projection_thread_activities_thread_created"] },
        { name: "orchestration_events", indexes: ["idx_orch_events_stream_sequence"] },
        { name: "projection_thread_messages", indexes: ["idx_projection_thread_messages_thread"] },
        { name: "projection_turns", indexes: ["idx_projection_turns_thread"] },
      ];
      const errors: string[] = [];
      for (const { name, indexes } of tables) {
        errors.push(...verifyIndexIntegrity(db, name, indexes));
      }
      expect(errors, `${eventSeq.n} events across 20 threads`).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
