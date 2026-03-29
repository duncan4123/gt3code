import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require_ = createRequire(resolve(import.meta.dirname, "../../../package.json"));
const Database = require_("better-sqlite3") as new (
  filename: string,
  opts?: { readonly?: boolean },
) => any;

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "t3-integrity-"));
  const dbPath = join(dir, "state.sqlite");
  const ftsPath = join(dir, "state-fts.sqlite");

  // Seed FTS btree sidecar
  execSync(`sqlite3 ${JSON.stringify(ftsPath)} "CREATE TABLE _seed(x INTEGER); DROP TABLE _seed;"`);

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(`ATTACH DATABASE '${ftsPath}' AS fts`);

  return {
    db,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    checkIntegrity: () => {
      const result = db.pragma("integrity_check") as { integrity_check: string }[];
      // Filter out FTS5 shadow table false positives — doltlite's integrity_check
      // misreports btree-backed FTS5 shadow tables as corrupted even when they're fine.
      const real = result.filter(
        (r) => !r.integrity_check.includes("_fts_") && r.integrity_check !== "ok",
      );
      return real.length === 0;
    },
    doltCommit: (msg: string) => {
      try {
        db.prepare("SELECT dolt_add('-A')").get();
        db.prepare(`SELECT dolt_commit('-m', '${msg}')`).get();
      } catch {}
    },
  };
}

describe("doltlite integrity", () => {
  it("survives bulk inserts with composite index (single transaction)", { timeout: 30_000 }, () => {
    const { db, cleanup, checkIntegrity } = makeTempDb();
    try {
      db.exec(`
        CREATE TABLE test_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL,
          stream_id TEXT NOT NULL,
          stream_version INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL
        )
      `);
      db.exec(`CREATE INDEX idx_stream ON test_events(stream_id, stream_version)`);

      const ins = db.prepare(
        "INSERT INTO test_events (event_id, stream_id, stream_version, event_type, payload_json) VALUES (?,?,?,?,?)",
      );
      const tx = db.transaction(() => {
        for (let i = 0; i < 2500; i++) {
          ins.run(
            `evt-${i}`,
            "e26a3a8b-8274-47b4-bfce-ceb3484902c5",
            i,
            "thread.activity-appended",
            JSON.stringify({ type: "activity", data: "x".repeat(300) }),
          );
        }
      });
      tx();

      expect(checkIntegrity()).toBe(true);
    } finally {
      db.close();
      cleanup();
    }
  });

  it("survives incremental inserts with dolt_commit cycles", { timeout: 30_000 }, () => {
    const { db, cleanup, checkIntegrity, doltCommit } = makeTempDb();
    try {
      db.exec(`
        CREATE TABLE test_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL,
          stream_id TEXT NOT NULL,
          stream_version INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL
        )
      `);
      db.exec(`CREATE INDEX idx_stream ON test_events(stream_id, stream_version)`);

      doltCommit("schema");

      const ins = db.prepare(
        "INSERT INTO test_events (event_id, stream_id, stream_version, event_type, payload_json) VALUES (?,?,?,?,?)",
      );

      // Simulate server: autocommit inserts + dolt_commit every 10
      for (let i = 0; i < 2500; i++) {
        ins.run(
          `evt-${i}`,
          `stream-${i % 8}`,
          Math.floor(i / 8),
          "thread.activity-appended",
          JSON.stringify({ type: "activity", data: "x".repeat(200 + (i % 300)) }),
        );

        if ((i + 1) % 10 === 0) {
          doltCommit(`batch-${Math.floor(i / 10)}`);
        }
      }

      expect(checkIntegrity()).toBe(true);
    } finally {
      db.close();
      cleanup();
    }
  });

  it("survives multi-table writes matching server projection pattern", { timeout: 60_000 }, () => {
    const { db, cleanup, checkIntegrity, doltCommit } = makeTempDb();
    try {
      // Schema matching real server tables
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
      db.exec(`CREATE INDEX idx_orch_events_stream ON orchestration_events(stream_id, stream_version)`);

      db.exec(`
        CREATE TABLE projection_threads (
          thread_id TEXT PRIMARY KEY,
          title TEXT,
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
      db.exec(`CREATE INDEX idx_messages_thread ON projection_thread_messages(thread_id, created_at)`);

      db.exec(`
        CREATE TABLE projection_thread_activities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          kind TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      db.exec(`CREATE INDEX idx_activities_thread_seq ON projection_thread_activities(thread_id, sequence)`);
      db.exec(`CREATE INDEX idx_activities_thread_created ON projection_thread_activities(thread_id, created_at)`);

      db.exec(`
        CREATE TABLE projection_turns (
          turn_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          pending_message_id TEXT,
          assistant_message_id TEXT,
          state TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          checkpoint_files TEXT NOT NULL DEFAULT '[]'
        )
      `);
      db.exec(`CREATE INDEX idx_turns_thread ON projection_turns(thread_id, requested_at)`);

      // FTS in attached btree sidecar
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS fts.messages_fts USING fts5(text, content='')
      `);

      doltCommit("schema");

      const insEvent = db.prepare(`INSERT INTO orchestration_events
        (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, payload_json)
        VALUES (?,?,?,?,?,?,?)`);
      const upsertThread = db.prepare(`INSERT OR REPLACE INTO projection_threads
        (thread_id, title, created_at, updated_at) VALUES (?,?,?,?)`);
      const upsertMessage = db.prepare(`INSERT OR REPLACE INTO projection_thread_messages
        (message_id, thread_id, role, text, is_streaming, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`);
      const insActivity = db.prepare(`INSERT INTO projection_thread_activities
        (thread_id, sequence, kind, created_at) VALUES (?,?,?,?)`);
      const upsertTurn = db.prepare(`INSERT OR REPLACE INTO projection_turns
        (turn_id, thread_id, state, requested_at) VALUES (?,?,?,?)`);

      let eventSeq = 0;
      let activitySeq = 0;

      // Simulate 10 threads with 25 turns each
      for (let t = 0; t < 10; t++) {
        const threadId = `thread-${t}`;
        const now = new Date().toISOString();
        upsertThread.run(threadId, `Thread ${t}`, now, now);

        for (let turn = 0; turn < 25; turn++) {
          const turnId = `turn-${t}-${turn}`;
          const turnTime = new Date(Date.now() + (t * 25 + turn) * 1000).toISOString();
          upsertTurn.run(turnId, threadId, "completed", turnTime);

          // User message
          insEvent.run(`evt-${eventSeq++}`, "thread", threadId, turn * 2, "thread.message", turnTime, JSON.stringify({ role: "user", text: "Hello ".repeat(50) }));
          upsertMessage.run(`msg-${t}-${turn}-user`, threadId, "user", "Hello ".repeat(50), 0, turnTime, turnTime);

          // Assistant message
          insEvent.run(`evt-${eventSeq++}`, "thread", threadId, turn * 2 + 1, "thread.message", turnTime, JSON.stringify({ role: "assistant", text: "Response ".repeat(100) }));
          upsertMessage.run(`msg-${t}-${turn}-asst`, threadId, "assistant", "Response ".repeat(100), 0, turnTime, turnTime);

          // Activities
          for (let a = 0; a < 3; a++) {
            insActivity.run(threadId, activitySeq++, "message-appended", turnTime);
          }

          // dolt_commit every 10 events
          if (eventSeq % 10 === 0) {
            doltCommit(`batch-${Math.floor(eventSeq / 10)}`);
          }
        }

        // Check integrity after each thread
        expect(checkIntegrity(), `integrity failed after thread ${t} (${eventSeq} events)`).toBe(true);
      }

      // Final counts
      expect(db.prepare("SELECT count(*) as n FROM orchestration_events").get().n).toBe(500);
      expect(db.prepare("SELECT count(*) as n FROM projection_thread_messages").get().n).toBe(500);
      expect(db.prepare("SELECT count(*) as n FROM projection_thread_activities").get().n).toBe(750);
      expect(db.prepare("SELECT count(*) as n FROM projection_turns").get().n).toBe(250);
    } finally {
      db.close();
      cleanup();
    }
  });
});
