import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const tempDir = mkdtempSync(join(tmpdir(), "doltlite-branch-per-session-"));
const dbPath = join(tempDir, "repro.sqlite");

function openDb() {
  const db = new Database(dbPath, { timeout: 5000 });
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}

function queryAll(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function step(name, fn) {
  try {
    const result = fn();
    console.log(`OK ${name}`);
    if (result !== undefined) {
      console.log(JSON.stringify(result, null, 2));
    }
    return result;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    throw error;
  }
}

let mainDb;
let branchDb;

try {
  mainDb = openDb();

  step("create schema", () => {
    mainDb.exec(`
      CREATE TABLE threads (
        thread_id TEXT PRIMARY KEY,
        title TEXT NOT NULL
      );
      INSERT INTO threads(thread_id, title) VALUES ('thread-main', 'Parent');
    `);
  });

  step("initial dolt commit on main", () =>
    queryAll(mainDb, "SELECT dolt_commit('-A', '-m', 'init branch repro')"),
  );

  step("main active branch before second connection", () =>
    queryAll(mainDb, "SELECT active_branch() AS active_branch"),
  );

  branchDb = openDb();

  step("create branch on second connection", () =>
    queryAll(branchDb, "SELECT dolt_branch('feature-branch')"),
  );

  step("checkout branch on second connection", () =>
    queryAll(branchDb, "SELECT dolt_checkout('feature-branch')"),
  );

  step("branch connection active branch", () =>
    queryAll(branchDb, "SELECT active_branch() AS active_branch"),
  );

  step("main connection active branch stays main", () =>
    queryAll(mainDb, "SELECT active_branch() AS active_branch"),
  );

  step("read rows on branch connection", () =>
    queryAll(branchDb, "SELECT thread_id, title FROM threads ORDER BY thread_id"),
  );

  step("read rows on original main connection", () =>
    queryAll(mainDb, "SELECT thread_id, title FROM threads ORDER BY thread_id"),
  );

  console.log("repro completed without failure");
} finally {
  if (branchDb) branchDb.close();
  if (mainDb) mainDb.close();
  rmSync(tempDir, { recursive: true, force: true });
}
