#!/usr/bin/env node
/**
 * Run dolt_gc() on a doltlite database using the patched better-sqlite3.
 * Usage: node scripts/doltlite-gc.mjs [path]
 * Default: ~/.t3/dev/state.sqlite
 */
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const require = createRequire(join(import.meta.url, "../../apps/server/package.json"));
const Database = require("better-sqlite3");

const dbPath = process.argv[2] ?? join(homedir(), ".t3", "dev", "state.sqlite");
console.log(`[doltlite-gc] Opening ${dbPath}`);

const db = new Database(dbPath);
try {
  const result = db.prepare("SELECT dolt_gc()").get();
  console.log(`[doltlite-gc] ${result["dolt_gc()"]}`);
} catch (e) {
  console.error(`[doltlite-gc] Failed: ${e.message}`);
  process.exit(1);
} finally {
  db.close();
}
