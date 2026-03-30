import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

function logStep(name, fn) {
  process.stdout.write(`\n== ${name} ==\n`);
  try {
    const result = fn();
    if (result !== undefined) {
      console.log(result);
    }
  } catch (error) {
    console.error(`FAILED at ${name}`);
    console.error(error);
    throw error;
  }
}

function openDb() {
  const db = new Database(":memory:", { timeout: 5000 });
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function createSchema(db, withFts) {
  db.exec(`
    CREATE TABLE projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attachments_json TEXT
    );

    CREATE INDEX idx_projection_thread_messages_thread_created
    ON projection_thread_messages(thread_id, created_at);
  `);

  if (withFts) {
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        text,
        content=''
      );

      INSERT INTO messages_fts(rowid, text)
      SELECT rowid, text FROM projection_thread_messages;
    `);
  }
}

function makeUpsert(db) {
  return db.prepare(`
    INSERT INTO projection_thread_messages (
      message_id,
      thread_id,
      turn_id,
      role,
      text,
      attachments_json,
      is_streaming,
      created_at,
      updated_at
    )
    VALUES (
      @message_id,
      @thread_id,
      @turn_id,
      @role,
      @text,
      COALESCE(
        @attachments_json,
        (
          SELECT attachments_json
          FROM projection_thread_messages
          WHERE message_id = @message_id
        )
      ),
      @is_streaming,
      @created_at,
      @updated_at
    )
    ON CONFLICT (message_id)
    DO UPDATE SET
      thread_id = excluded.thread_id,
      turn_id = excluded.turn_id,
      role = excluded.role,
      text = excluded.text,
      attachments_json = COALESCE(
        excluded.attachments_json,
        projection_thread_messages.attachments_json
      ),
      is_streaming = excluded.is_streaming,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
}

function readRows(db) {
  return db
    .prepare(
      `
        SELECT rowid, message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
        FROM projection_thread_messages
        ORDER BY created_at ASC, message_id ASC
      `,
    )
    .all();
}

function checkDb(db) {
  return {
    integrity: db.pragma("integrity_check", { simple: true }),
    quick: db.pragma("quick_check", { simple: true }),
  };
}

function maybeUpdateFts(db, text) {
  const row = db
    .prepare(`SELECT rowid FROM projection_thread_messages WHERE message_id = ?`)
    .get("assistant:item-1");
  if (!row) return;
  db.prepare(`INSERT INTO messages_fts(rowid, text) VALUES (?, ?)`).run(row.rowid, text);
}

function runScenario({ withFts }) {
  const db = openDb();
  createSchema(db, withFts);
  const upsert = makeUpsert(db);
  const now = new Date().toISOString();

  logStep(`open transaction${withFts ? " with FTS" : ""}`, () => {
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    return checkDb(db);
  });

  logStep("streaming delta upsert", () => {
    upsert.run({
      message_id: "assistant:item-1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      role: "assistant",
      text: "buffer me",
      attachments_json: null,
      is_streaming: 1,
      created_at: now,
      updated_at: now,
    });
    if (withFts) {
      maybeUpdateFts(db, "buffer me");
    }
    return {
      rows: readRows(db),
      checks: checkDb(db),
    };
  });

  logStep("final completion upsert", () => {
    upsert.run({
      message_id: "assistant:item-1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      role: "assistant",
      text: "buffer me",
      attachments_json: null,
      is_streaming: 0,
      created_at: now,
      updated_at: now,
    });
    return {
      rows: readRows(db),
      checks: checkDb(db),
    };
  });

  logStep("commit", () => {
    db.exec("COMMIT");
    return checkDb(db);
  });

  db.close();
}

try {
  runScenario({ withFts: false });
  runScenario({ withFts: true });
  console.log("\nrepro completed without failure");
} catch {
  process.exitCode = 1;
}
