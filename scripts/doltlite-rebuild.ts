#!/usr/bin/env -S node --import=tsx/esm
/**
 * doltlite-rebuild — Diagnose and rebuild a corrupted doltlite database.
 *
 * Exports all table data from the current database, creates a fresh one
 * with the same schema, and reimports. Fixes chunk-level corruption that
 * prevents dolt_gc() from compacting.
 *
 * Usage:
 *   bun scripts/doltlite-rebuild.ts                           # diagnose only
 *   bun scripts/doltlite-rebuild.ts --rebuild                 # backup + rebuild
 *   bun scripts/doltlite-rebuild.ts --path ~/.t3/dev/state.sqlite
 */

import { createRequire } from "node:module";
import { existsSync, copyFileSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// Use the doltlite-linked better-sqlite3 from apps/server
const require_ = createRequire(resolve(import.meta.dirname, "../apps/server/package.json"));
const Database = require_("better-sqlite3") as new (filename: string, opts?: { readonly?: boolean }) => any;

// ── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const pathIdx = args.indexOf("--path");
const dbPath = resolve(
  pathIdx >= 0 && args[pathIdx + 1] ? args[pathIdx + 1] : `${process.env.HOME}/.t3/dev/state.sqlite`,
);
const ftsPath = dbPath.replace(/\.sqlite$/, "-fts.sqlite");
const doRebuild = args.includes("--rebuild");

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const sizeMB = (p: string) => (statSync(p).size / 1024 / 1024).toFixed(1);

// ── 1. Diagnose ─────────────────────────────────────────────────────────────

console.log(`\n=== doltlite-rebuild: ${dbPath} ===\n`);
console.log(`File size:    ${sizeMB(dbPath)} MB`);
if (existsSync(ftsPath)) console.log(`FTS sidecar:  ${sizeMB(ftsPath)} MB`);

const db = new Database(dbPath, { readonly: true });

// Engine check
try {
  const engine = db.prepare("SELECT doltlite_engine() as e").get();
  console.log(`Engine:       ${engine.e}`);
} catch {
  console.log(`Engine:       unknown (doltlite_engine not available)`);
}

// Integrity
const integrity = db.pragma("integrity_check");
const integrityOk = integrity.length === 1 && integrity[0].integrity_check === "ok";
console.log(`Integrity:    ${integrityOk ? "OK" : "FAILED"}`);
if (!integrityOk) {
  for (const r of integrity.slice(0, 10)) {
    console.log(`  - ${r.integrity_check}`);
  }
  if (integrity.length > 10) console.log(`  ... and ${integrity.length - 10} more`);
}

// Commits
let commitCount = 0;
try {
  commitCount = db.prepare("SELECT count(*) as n FROM dolt_log").get().n;
  console.log(`Dolt commits: ${commitCount}`);
} catch (e: any) {
  console.log(`Dolt commits: error - ${e.message}`);
}

// Table inventory
const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'dolt_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all() as { name: string }[];

console.log(`\nTables (${tables.length}):`);
const tableData: Record<string, any[]> = {};
let totalRows = 0;
for (const { name } of tables) {
  try {
    const rows = db.prepare(`SELECT * FROM "${name}"`).all();
    tableData[name] = rows;
    totalRows += rows.length;
    console.log(`  ${name.padEnd(45)} ${String(rows.length).padStart(6)} rows`);
  } catch (e: any) {
    console.log(`  ${name.padEnd(45)} ERROR: ${e.message}`);
    tableData[name] = [];
  }
}
console.log(`  ${"TOTAL".padEnd(45)} ${String(totalRows).padStart(6)} rows`);

// GC check
db.close();

let gcWorks = false;
let gcError = "";
try {
  const gcDb = new Database(dbPath);
  const r = gcDb.prepare("SELECT dolt_gc() as result").get();
  console.log(`\nGC status:    OK (${r.result})`);
  gcWorks = true;
  gcDb.close();
} catch (e: any) {
  gcError = e.message;
  console.log(`\nGC status:    BROKEN - ${gcError}`);
  // Re-check integrity after failed GC attempt (it might have left things worse)
  const checkDb = new Database(dbPath, { readonly: true });
  const recheck = checkDb.pragma("integrity_check");
  const recheckOk = recheck.length === 1 && recheck[0].integrity_check === "ok";
  if (!recheckOk) console.log(`  (GC attempt also corrupted indexes — will need REINDEX)`);
  checkDb.close();
}

// ── Summary ─────────────────────────────────────────────────────────────────

const needsRebuild = !gcWorks || !integrityOk;
if (!needsRebuild) {
  console.log("\nDatabase is healthy. No rebuild needed.");
  process.exit(0);
}

console.log(`\n--- Diagnosis ---`);
if (!integrityOk) console.log(`  Index corruption detected (fixable with REINDEX)`);
if (!gcWorks) console.log(`  GC broken: ${gcError}`);
console.log(`  File bloat: ${sizeMB(dbPath)} MB for ${totalRows} rows across ${commitCount} commits`);

if (!doRebuild) {
  console.log(`\nRun with --rebuild to fix:`);
  console.log(`  bun scripts/doltlite-rebuild.ts --rebuild`);
  process.exit(1);
}

// ── 2. Rebuild ──────────────────────────────────────────────────────────────

const bakPath = `${dbPath}.${Date.now()}.bak`;
console.log(`\n--- Rebuilding ---`);
console.log(`Backing up to ${bakPath}`);
copyFileSync(dbPath, bakPath);
if (existsSync(ftsPath)) copyFileSync(ftsPath, `${ftsPath}.${Date.now()}.bak`);

// Get schema from backup
const bakDb = new Database(bakPath, { readonly: true });
const schemaRows = bakDb
  .prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL
       AND name NOT LIKE 'dolt_%'
       AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, name`,
  )
  .all() as { type: string; name: string; sql: string }[];
bakDb.close();

// Remove old files
console.log("Removing corrupted database ...");
unlinkSync(dbPath);
if (existsSync(ftsPath)) unlinkSync(ftsPath);

// Create fresh database
console.log("Creating fresh database ...");
const newDb = new Database(dbPath);

// Seed FTS btree sidecar
execSync(`sqlite3 ${JSON.stringify(ftsPath)} "CREATE TABLE _seed(x INTEGER); DROP TABLE _seed;"`);
newDb.exec(`ATTACH DATABASE '${ftsPath}' AS fts`);

// Replay schema
console.log("Applying schema ...");
for (const { type, name, sql } of schemaRows) {
  try {
    newDb.exec(sql);
  } catch (e: any) {
    if (!e.message.includes("already exists")) {
      console.log(`  ${type} ${name}: ${e.message}`);
    }
  }
}

// Import data — batch inserts to avoid doltlite prolly-tree chunk boundary
// bug that corrupts indexes in transactions over ~1900 rows.
const BATCH_SIZE = 500;
console.log("Importing data ...");
newDb.pragma("foreign_keys = OFF");
for (const [name, rows] of Object.entries(tableData)) {
  if (rows.length === 0) continue;
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => "?").join(", ");
  const sql = `INSERT OR REPLACE INTO "${name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
  try {
    const insert = newDb.prepare(sql);
    const tx = newDb.transaction((batch: any[]) => {
      for (const row of batch) {
        insert.run(...cols.map((c) => row[c]));
      }
    });
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      tx(rows.slice(i, i + BATCH_SIZE));
    }
    console.log(`  ${name}: ${rows.length} rows`);
  } catch (e: any) {
    console.error(`  ${name}: FAILED - ${e.message}`);
  }
}
newDb.pragma("foreign_keys = ON");

// REINDEX — doltlite's prolly-tree corrupts indexes during bulk INSERT
console.log("Rebuilding indexes (REINDEX) ...");
newDb.exec("REINDEX;");

// Dolt commit
console.log("Creating dolt commit ...");
try {
  newDb.prepare("SELECT dolt_add('-A')").get();
  newDb.prepare("SELECT dolt_commit('-m', 'rebuild: reimported from corrupted database')").get();
  // REINDEX again after dolt_commit — commit can desync indexes too
  newDb.exec("REINDEX;");
} catch (e: any) {
  console.log(`  Warning: ${e.message}`);
}

// ── 3. Verify ───────────────────────────────────────────────────────────────

console.log("\n--- Verification ---");

const vIntegrity = newDb.pragma("integrity_check");
const vOk = vIntegrity.length === 1 && vIntegrity[0].integrity_check === "ok";
console.log(`Integrity:  ${vOk ? "OK" : "FAILED"}`);

let vGc = false;
try {
  const r = newDb.prepare("SELECT dolt_gc() as result").get();
  console.log(`GC:         OK (${r.result})`);
  vGc = true;
} catch (e: any) {
  console.log(`GC:         FAILED - ${e.message}`);
}

// Row count verification
let newTotal = 0;
for (const { name } of tables) {
  try {
    newTotal += newDb.prepare(`SELECT count(*) as n FROM "${name}"`).get().n;
  } catch {}
}
console.log(`Rows:       ${newTotal} / ${totalRows} (${newTotal === totalRows ? "match" : "MISMATCH"})`);
console.log(`Size:       ${sizeMB(dbPath)} MB (was ${sizeMB(bakPath)} MB)`);

newDb.close();

if (vOk && vGc && newTotal === totalRows) {
  console.log("\nRebuild successful!");
} else {
  console.log("\nRebuild completed with warnings — check output above.");
  process.exit(1);
}
