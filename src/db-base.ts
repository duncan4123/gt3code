/**
 * db-base — Reusable SQLite infrastructure for context-mode packages.
 *
 * Provides lazy-loading of better-sqlite3, WAL pragma setup, prepared
 * statement caching interface, and DB file cleanup helpers. Both
 * ContentStore and SessionDB build on top of these primitives.
 */

import type DatabaseConstructor from "better-sqlite3";
import type { Database as DatabaseInstance } from "better-sqlite3";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

/**
 * Explicit interface for cached prepared statements that accept varying
 * parameter counts. better-sqlite3's generic `Statement` collapses under
 * `ReturnType` to a single-param signature, so we define our own.
 */
export interface PreparedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

// ─────────────────────────────────────────────────────────
// bun:sqlite adapter (#45)
// ─────────────────────────────────────────────────────────

/**
 * Wraps a bun:sqlite Database to provide better-sqlite3-compatible API.
 * Bridges: .pragma(), multi-statement .exec(), .get() null→undefined.
 */
export class BunSQLiteAdapter {
  #raw: any;

  constructor(rawDb: any) {
    this.#raw = rawDb;
  }

  pragma(source: string): any {
    const stmt = this.#raw.prepare(`PRAGMA ${source}`);
    const rows = stmt.all();
    if (!rows || rows.length === 0) return undefined;
    // Multi-row pragmas (table_xinfo, etc.) → return array
    if (rows.length > 1) return rows;
    // Single-row: extract scalar value (e.g. journal_mode = "wal")
    const values = Object.values(rows[0] as Record<string, unknown>);
    return values.length === 1 ? values[0] : rows[0];
  }

  exec(sql: string): any {
    // bun:sqlite .exec() is single-statement only.
    // Split multi-statement SQL respecting string literals (don't split on ; inside quotes).
    let current = "";
    let inString: string | null = null;
    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      if (inString) {
        current += ch;
        if (ch === inString) inString = null;
      } else if (ch === "'" || ch === '"') {
        current += ch;
        inString = ch;
      } else if (ch === ";") {
        const trimmed = current.trim();
        if (trimmed) this.#raw.prepare(trimmed).run();
        current = "";
      } else {
        current += ch;
      }
    }
    const trimmed = current.trim();
    if (trimmed) this.#raw.prepare(trimmed).run();
    return this;
  }

  prepare(sql: string): any {
    const stmt = this.#raw.prepare(sql);
    return {
      run: (...args: unknown[]) => stmt.run(...args),
      get: (...args: unknown[]) => {
        const r = stmt.get(...args);
        return r === null ? undefined : r;
      },
      all: (...args: unknown[]) => stmt.all(...args),
      iterate: (...args: unknown[]) => stmt.iterate(...args),
    };
  }

  transaction(fn: (...args: any[]) => any): any {
    return this.#raw.transaction(fn);
  }

  close(): void {
    this.#raw.close();
  }
}

// ─────────────────────────────────────────────────────────
// Lazy loader
// ─────────────────────────────────────────────────────────

let _Database: typeof DatabaseConstructor | null = null;

/**
 * Lazy-load the SQLite driver for the current runtime.
 * Bun → bun:sqlite via BunSQLiteAdapter (issue #45).
 * Node → better-sqlite3 (native addon).
 */
export function loadDatabase(): typeof DatabaseConstructor {
  if (!_Database) {
    const require = createRequire(import.meta.url);

    if ((globalThis as any).Bun) {
      // Bun runtime — use bun:sqlite directly.
      // Array.join() prevents esbuild from resolving the specifier at bundle time.
      const BunDB = require(["bun", "sqlite"].join(":")).Database;
      _Database = function BunDatabaseFactory(path: string, opts?: any) {
        const raw = new BunDB(path, {
          readonly: opts?.readonly,
          create: true,
        });
        return new BunSQLiteAdapter(raw);
      } as any;
    } else {
      // Node.js — use better-sqlite3.
      // Guard against ABI mismatch: if the native addon was compiled for a
      // different Node version (e.g. plugin installed under Node X, session
      // runs Node Y), rebuild automatically and retry once.
      try {
        _Database = require("better-sqlite3") as typeof DatabaseConstructor;
      } catch (err: any) {
        if (err?.message?.includes("NODE_MODULE_VERSION") ||
            err?.message?.includes("was compiled against") ||
            err?.code === "ERR_DLOPEN_FAILED") {
          // Rebuild via patch-doltlite.mjs to preserve doltlite linkage.
          // No fallback to plain SQLite — doltlite is required.
          const __pkg_dir = dirname(fileURLToPath(import.meta.url));
          const patchScript = join(__pkg_dir, "..", "scripts", "patch-doltlite.mjs");
          process.stderr.write(
            `[context-mode] ABI mismatch detected (Node ${process.version}), rebuilding better-sqlite3 with doltlite...\n`,
          );
          try {
            if (!existsSync(patchScript)) {
              throw new Error(`patch-doltlite.mjs not found at ${patchScript}`);
            }
            execSync(`node ${patchScript}`, {
              cwd: join(__pkg_dir, ".."),
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 120_000,
            });
            // Clear Node's module cache so the fresh .node file is loaded
            delete require.cache[require.resolve("better-sqlite3")];
            _Database = require("better-sqlite3") as typeof DatabaseConstructor;
            process.stderr.write("[context-mode] better-sqlite3 rebuilt successfully\n");
          } catch (rebuildErr: any) {
            process.stderr.write(
              `[context-mode] auto-rebuild failed: ${rebuildErr?.message ?? rebuildErr}\n`,
            );
            throw err; // rethrow original error
          }
        } else {
          throw err;
        }
      }
    }
  }
  return _Database!;
}

// ─────────────────────────────────────────────────────────
// WAL setup
// ─────────────────────────────────────────────────────────

/**
 * Apply WAL mode and NORMAL synchronous pragma to a database instance.
 * Should be called immediately after opening a new database connection.
 *
 * WAL mode provides:
 * - Concurrent readers while a write is in progress
 * - Dramatically faster writes (no full-page sync on each commit)
 * NORMAL synchronous is safe under WAL and avoids an extra fsync per
 * transaction.
 */
export function applyWALPragmas(db: DatabaseInstance): void {
  // Skip WAL under doltlite — it manages its own journal (#131)
  try {
    (db as any).prepare("SELECT doltlite_engine()").get();
    return; // doltlite active, skip WAL
  } catch { /* standard SQLite — apply WAL below */ }
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
}

// ─────────────────────────────────────────────────────────
// DB file helpers
// ─────────────────────────────────────────────────────────

/**
 * Delete database files for a given db path.
 *
 * Under stock SQLite this removes the main file plus WAL/SHM sidecars.
 * Under doltlite (Manifest V6) the WAL is merged into the main file so
 * `-wal`/`-shm` won't exist — deletion attempts are harmlessly ignored.
 */
export function deleteDBFiles(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(dbPath + suffix);
    } catch {
      // ignore — file may not exist (expected for doltlite single-file format)
    }
  }
}

/**
 * Safely close a database connection. Swallows errors so callers can
 * always call this in a finally/cleanup path without try/catch.
 *
 * Under doltlite the WAL is merged into the main file (Manifest V6,
 * single-file storage — upstream doltlite#118), so SQLite-level
 * wal_checkpoint is skipped entirely.
 */
export function closeDB(db: DatabaseInstance): void {
  try {
    // Skip checkpoint under doltlite — its WAL is internal (#131, doltlite#118)
    const isDoltlite = (() => {
      try {
        (db as any).prepare("SELECT doltlite_engine()").get();
        return true;
      } catch { return false; }
    })();
    if (!isDoltlite) {
      // Checkpoint WAL before close to prevent contention on restart (#103)
      db.pragma("wal_checkpoint(TRUNCATE)");
    }
  } catch { /* WAL may not be active */ }
  try {
    db.close();
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────
// Default path helper
// ─────────────────────────────────────────────────────────

/**
 * Return the default per-process DB path for context-mode databases.
 * Uses the OS temp directory and embeds the current PID so multiple
 * server instances never share a file.
 */
export function defaultDBPath(prefix: string = "context-mode"): string {
  return join(tmpdir(), `${prefix}-${process.pid}.db`);
}

// ─────────────────────────────────────────────────────────
// Base class
// ─────────────────────────────────────────────────────────

/**
 * SQLiteBase — minimal base class that handles open/close/cleanup lifecycle.
 *
 * Subclasses call `super(dbPath)` to open the database with WAL pragmas
 * applied, then implement `initSchema()` and `prepareStatements()`.
 *
 * The `db` getter exposes the raw `DatabaseInstance` to subclasses only.
 */
export abstract class SQLiteBase {
  readonly #dbPath: string;
  readonly #db: DatabaseInstance;

  constructor(dbPath: string) {
    const Database = loadDatabase();
    this.#dbPath = dbPath;
    this.#db = new Database(dbPath, { timeout: 5000 });
    applyWALPragmas(this.#db);
    this.initSchema();
    this.prepareStatements();
  }

  /** Called once after WAL pragmas are applied. Subclasses run CREATE TABLE/VIRTUAL TABLE here. */
  protected abstract initSchema(): void;

  /** Called once after schema init. Subclasses compile and cache their prepared statements here. */
  protected abstract prepareStatements(): void;

  /** Raw database instance — available to subclasses only. */
  protected get db(): DatabaseInstance {
    return this.#db;
  }

  /** The path this database was opened from. */
  get dbPath(): string {
    return this.#dbPath;
  }

  /** Close the database connection without deleting files. */
  close(): void {
    closeDB(this.#db);
  }

  /**
   * Close the connection and delete all associated DB files (main, WAL, SHM).
   * Call on process exit or at end of session lifecycle.
   */
  cleanup(): void {
    closeDB(this.#db);
    deleteDBFiles(this.#dbPath);
  }
}
