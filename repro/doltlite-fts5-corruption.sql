.bail on
CREATE VIRTUAL TABLE chunks USING fts5(
  title,
  content,
  source_id UNINDEXED,
  content_type UNINDEXED,
  tokenize='porter unicode61'
);
-- src/db-base.ts: 4 chunks
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (1000001, 'untitled (1)', '/**
 * db-base — Reusable SQLite infrastructure for context-mode packages.
 *
 * Provides lazy-loading of better-sqlite3, WAL pragma setup, prepared
 * statement caching interface, and DB file cleanup helpers. Both
 * ContentStore and SessionDB build on top of these primitives.
 */

import type DatabaseConstructor from "better-sqlite3";
import type { Database as DatabaseInstance } from "better-sqlite3";
import { createRequire } from "node:module";
import { unlinkSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

declare global {
  // eslint-disable-next-line no-var
  var __DOLTLITE_NATIVE_PATH: string | undefined;
}

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

/**
 * Explicit interface for cached prepared statements that accept varying
 * parameter counts. better-sqlite3''s generic `Statement` collapses under
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
    // Split multi-statement SQL respecting string literals (don''t split on ; inside quotes).
    let current = "";
    let inString: string | null = null;
    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      if (inString) {
        current += ch;
        if (ch === inString) inString = null;
      } else if (ch === "''" || ch === ''"'') {
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
}', 1, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (1000002, 'untitled (2)', '// ─────────────────────────────────────────────────────────
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

    // Self-bootstrap: if start.mjs didn''t run (Claude Code sometimes
    // launches server.bundle.mjs directly), install the ABI-matched
    // prebuilt native binary before requiring the vendored module.
    if (!globalThis.__DOLTLITE_NATIVE_PATH) {
      // From src/: dirname gives src/, prebuilds/ won''t exist → skip (start.mjs handles it)
      // From bundle at root: dirname gives plugin root where prebuilds/ lives
      const baseDir = dirname(fileURLToPath(import.meta.url));
      const abi = process.versions.modules;
      const prebuildSrc = join(baseDir, "prebuilds", `${process.platform}-${process.arch}`, `node.abi${abi}.node`);
      const targetDir = join(baseDir, "vendor", "better-sqlite3", "build", "Release");
      const targetBin = join(targetDir, "better_sqlite3.node");

      if (existsSync(prebuildSrc)) {
        let needsCopy = !existsSync(targetBin);
        if (!needsCopy) {
          try {
            if (statSync(prebuildSrc).size !== statSync(targetBin).size) needsCopy = true;
          } catch { needsCopy = true; }
        }
        if (needsCopy) {
          mkdirSync(targetDir, { recursive: true });
          copyFileSync(prebuildSrc, targetBin);
        }
        globalThis.__DOLTLITE_NATIVE_PATH = targetBin;
      }
    }

    try {
      _Database = require("../vendor/better-sqlite3") as typeof DatabaseConstructor;
    } catch (err: any) {
      throw err;
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
// ─────────────────────────────────────────────────────────', 1, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (1000003, 'untitled (3)', '/**
 * Delete database files for a given db path.
 *
 * Under stock SQLite this removes the main file plus WAL/SHM sidecars.
 * Under doltlite (Manifest V6) the WAL is merged into the main file so
 * `-wal`/`-shm` won''t exist — deletion attempts are harmlessly ignored.
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
// Retry helper
// ─────────────────────────────────────────────────────────

/**
 * Retry a DB operation with exponential backoff on SQLITE_BUSY errors.
 * Catches errors containing "SQLITE_BUSY" or "database is locked" and
 * retries up to 3 times with delays: 100ms, 500ms, 2000ms.
 * If all retries fail, throws a descriptive error.
 * Pass custom delays for testing (e.g., [0, 0, 0] to skip waits).
 */
export function withRetry<T>(fn: () => T, delays: number[] = [100, 500, 2000]): T {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("SQLITE_BUSY") && !msg.includes("database is locked")) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(msg);
      if (attempt < delays.length) {
        const delay = delays[attempt];
        const start = Date.now();
        while (Date.now() - start < delay) { /* busy-wait for sync retry */ }
      }
    }
  }
  throw new Error(
    `SQLITE_BUSY: database is locked after ${delays.length} retries. ` +
    `Original error: ${lastError?.message}`
  );
}

// ─────────────────────────────────────────────────────────
// Base class
// ─────────────────────────────────────────────────────────', 1, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (1000004, 'untitled (4)', '/**
 * SQLiteBase — minimal base class that handles open/close/cleanup lifecycle.
 *
 * Subclasses call `super(dbPath)` to open the database with WAL pragmas
 * applied, then implement `initSchema()` and `prepareStatements()`.
 *
 * The `db` getter exposes the raw `DatabaseInstance` to subclasses only.
 */
/**
 * Track all live DatabaseInstance objects so we can close them on process exit.
 * Prevents better-sqlite3 segfaults caused by V8 garbage-collecting Database
 * objects after the native addon context is already torn down.
 *
 * Uses a global symbol so the set and exit handler survive vitest''s module
 * re-imports within the same fork process (ESM isolate mode clears
 * module-level state but globalThis persists).
 */
const _kLiveDBs = Symbol.for("__context_mode_live_dbs__");
const _liveDBs: Set<DatabaseInstance> = (() => {
  const g = globalThis as Record<symbol, Set<DatabaseInstance> | undefined>;
  if (!g[_kLiveDBs]) {
    g[_kLiveDBs] = new Set<DatabaseInstance>();
    process.on("exit", () => {
      for (const db of g[_kLiveDBs]!) {
        try { db.close(); } catch { /* already closed */ }
      }
      g[_kLiveDBs]!.clear();
    });
  }
  return g[_kLiveDBs]!;
})();

export abstract class SQLiteBase {
  readonly #dbPath: string;
  readonly #db: DatabaseInstance;

  constructor(dbPath: string) {
    const Database = loadDatabase();
    this.#dbPath = dbPath;
    this.#db = new Database(dbPath, { timeout: 30000 });
    _liveDBs.add(this.#db);
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
    _liveDBs.delete(this.#db);
    closeDB(this.#db);
  }

  protected withRetry<T>(fn: () => T): T {
    return withRetry(fn);
  }

  /**
   * Close the connection and delete all associated DB files (main, WAL, SHM).
   * Call on process exit or at end of session lifecycle.
   */
  cleanup(): void {
    _liveDBs.delete(this.#db);
    closeDB(this.#db);
    deleteDBFiles(this.#dbPath);
  }
}', 1, 'prose');
-- src/runtime.ts: 3 chunks
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (2000001, 'untitled (1)', 'import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

export type Language =
  | "javascript"
  | "typescript"
  | "python"
  | "shell"
  | "ruby"
  | "go"
  | "rust"
  | "php"
  | "perl"
  | "r"
  | "elixir";

export interface RuntimeInfo {
  command: string;
  available: boolean;
  version: string;
  preferred: boolean;
}

export interface RuntimeMap {
  javascript: string;
  typescript: string | null;
  python: string | null;
  shell: string;
  ruby: string | null;
  go: string | null;
  rust: string | null;
  php: string | null;
  perl: string | null;
  r: string | null;
  elixir: string | null;
}

const isWindows = process.platform === "win32";

function commandExists(cmd: string): boolean {
  try {
    const check = isWindows ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(check, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function bunExists(): boolean {
  if (commandExists("bun")) return true;
  // Bun installs to ~/.bun/bin which may not be in PATH in MCP server environments
  if (!isWindows) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (home && existsSync(`${home}/.bun/bin/bun`)) return true;
  }
  return false;
}

function bunCommand(): string {
  if (commandExists("bun")) return "bun";
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return `${home}/.bun/bin/bun`;
}

/**
 * On Windows, resolve the first non-WSL bash in PATH.
 * WSL bash (C:\Windows\System32\bash.exe) cannot handle Windows paths,
 * so we skip it and prefer Git Bash or MSYS2 bash instead.
 */
function resolveWindowsBash(): string | null {
  // First, try well-known Git Bash locations directly (works even when
  // Git\usr\bin is not on PATH, which is common in MCP server environments
  // that only inherit Git\cmd from the system PATH).
  const knownPaths = [
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
  ];
  for (const p of knownPaths) {
    if (existsSync(p)) return p;
  }

  // Fallback: scan PATH via `where bash`, skipping WSL and WindowsApps entries.
  try {
    const result = execSync("where bash", { encoding: "utf-8", stdio: "pipe" });
    const candidates = result.trim().split(/\r?\n/).map(p => p.trim()).filter(Boolean);
    for (const p of candidates) {
      const lower = p.toLowerCase();
      if (lower.includes("system32") || lower.includes("windowsapps")) continue;
      return p;
    }
    return null;
  } catch {
    return null;
  }
}

function getVersion(cmd: string): string {
  try {
    return execSync(`${cmd} --version`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    })
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    return "unknown";
  }
}

export function detectRuntimes(): RuntimeMap {
  // Always use the same Node.js that runs the MCP server for JS/TS.
  // Bun resolves native modules from its own cache (~/.bun/install/cache/),
  // which doesn''t have the doltlite-linked better-sqlite3 binary.
  // One runtime = one module path = one native binary = reliable.
  return {
    javascript: process.execPath,
    typescript: commandExists("tsx")
      ? "tsx"
      : commandExists("ts-node")
        ? "ts-node"
        : null,
    python: commandExists("python3")
      ? "python3"
      : commandExists("python")
        ? "python"
        : null,
    shell: isWindows
      ? (resolveWindowsBash() ?? (commandExists("sh") ? "sh" : commandExists("powershell") ? "powershell" : "cmd.exe"))
      : commandExists("bash") ? "bash" : "sh",
    ruby: commandExists("ruby") ? "ruby" : null,
    go: commandExists("go") ? "go" : null,
    rust: commandExists("rustc") ? "rustc" : null,
    php: commandExists("php") ? "php" : null,
    perl: commandExists("perl") ? "perl" : null,
    r: commandExists("Rscript")
      ? "Rscript"
      : commandExists("r")
        ? "r"
        : null,
    elixir: commandExists("elixir") ? "elixir" : null,
  };
}

export function hasBunRuntime(): boolean {
  return bunExists();
}', 2, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (2000002, 'untitled (2)', 'export function getRuntimeSummary(runtimes: RuntimeMap): string {
  const lines: string[] = [];
  const bunPreferred = runtimes.javascript?.endsWith("bun") ?? false;

  lines.push(
    `  JavaScript: ${runtimes.javascript} (${getVersion(runtimes.javascript)})${bunPreferred ? " ⚡" : ""}`,
  );

  if (runtimes.typescript) {
    lines.push(
      `  TypeScript: ${runtimes.typescript} (${getVersion(runtimes.typescript)})`,
    );
  } else {
    lines.push(
      `  TypeScript: not available (install bun, tsx, or ts-node)`,
    );
  }

  if (runtimes.python) {
    lines.push(
      `  Python:     ${runtimes.python} (${getVersion(runtimes.python)})`,
    );
  } else {
    lines.push(`  Python:     not available`);
  }

  lines.push(
    `  Shell:      ${runtimes.shell} (${getVersion(runtimes.shell)})`,
  );

  // Optional runtimes — only show if available
  if (runtimes.ruby)
    lines.push(
      `  Ruby:       ${runtimes.ruby} (${getVersion(runtimes.ruby)})`,
    );
  if (runtimes.go)
    lines.push(`  Go:         ${runtimes.go} (${getVersion(runtimes.go)})`);
  if (runtimes.rust)
    lines.push(
      `  Rust:       ${runtimes.rust} (${getVersion(runtimes.rust)})`,
    );
  if (runtimes.php)
    lines.push(
      `  PHP:        ${runtimes.php} (${getVersion(runtimes.php)})`,
    );
  if (runtimes.perl)
    lines.push(
      `  Perl:       ${runtimes.perl} (${getVersion(runtimes.perl)})`,
    );
  if (runtimes.r)
    lines.push(`  R:          ${runtimes.r} (${getVersion(runtimes.r)})`);
  if (runtimes.elixir)
    lines.push(
      `  Elixir:     ${runtimes.elixir} (${getVersion(runtimes.elixir)})`,
    );

  if (!bunPreferred) {
    lines.push("");
    lines.push(
      "  Tip: Install Bun for 3-5x faster JS/TS execution → https://bun.sh",
    );
  }

  return lines.join("\n");
}

export function getAvailableLanguages(runtimes: RuntimeMap): Language[] {
  const langs: Language[] = ["javascript", "shell"];
  if (runtimes.typescript) langs.push("typescript");
  if (runtimes.python) langs.push("python");
  if (runtimes.ruby) langs.push("ruby");
  if (runtimes.go) langs.push("go");
  if (runtimes.rust) langs.push("rust");
  if (runtimes.php) langs.push("php");
  if (runtimes.perl) langs.push("perl");
  if (runtimes.r) langs.push("r");
  if (runtimes.elixir) langs.push("elixir");
  return langs;
}

export function buildCommand(
  runtimes: RuntimeMap,
  language: Language,
  filePath: string,
): string[] {
  switch (language) {
    case "javascript":
      return runtimes.javascript.endsWith("bun")
        ? [runtimes.javascript, "run", filePath]
        : [runtimes.javascript, filePath];

    case "typescript":
      if (!runtimes.typescript) {
        throw new Error(
          "No TypeScript runtime available. Install one of: bun (recommended), tsx (npm i -g tsx), or ts-node.",
        );
      }
      if (runtimes.typescript?.endsWith("bun")) return [runtimes.typescript, "run", filePath];
      if (runtimes.typescript === "tsx") return ["tsx", filePath];
      return ["ts-node", filePath];

    case "python":
      if (!runtimes.python) {
        throw new Error(
          "No Python runtime available. Install python3 or python.",
        );
      }
      return [runtimes.python, filePath];

    case "shell":
      return [runtimes.shell, filePath];

    case "ruby":
      if (!runtimes.ruby) {
        throw new Error("Ruby not available. Install ruby.");
      }
      return [runtimes.ruby, filePath];

    case "go":
      if (!runtimes.go) {
        throw new Error("Go not available. Install go.");
      }
      return ["go", "run", filePath];

    case "rust": {
      if (!runtimes.rust) {
        throw new Error(
          "Rust not available. Install rustc via https://rustup.rs",
        );
      }
      // Rust needs compile + run — handled specially in executor
      return ["__rust_compile_run__", filePath];
    }

    case "php":
      if (!runtimes.php) {
        throw new Error("PHP not available. Install php.");
      }
      return ["php", filePath];', 2, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (2000003, 'untitled (3)', 'case "perl":
      if (!runtimes.perl) {
        throw new Error("Perl not available. Install perl.");
      }
      return ["perl", filePath];

    case "r":
      if (!runtimes.r) {
        throw new Error("R not available. Install R / Rscript.");
      }
      return [runtimes.r, filePath];

    case "elixir":
      if (!runtimes.elixir) {
        throw new Error( "Elixir not available. Install elixir.");
      }
      return ["elixir", filePath];
  }
}', 2, 'prose');
-- src/session/extract.ts: 5 chunks
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (3000001, 'untitled (1)', '/**
 * Session event extraction — pure functions, zero side effects.
 * Extracts structured events from Claude Code tool calls and user messages.
 *
 * All 13 event categories as specified in PRD Section 3.
 */

// ── Public interfaces ──────────────────────────────────────────────────────

export interface SessionEvent {
  /** e.g. "file_read", "file_write", "cwd", "error_tool", "git", "task",
   *  "decision", "rule", "env", "role", "skill", "subagent", "data", "intent" */
  type: string;
  /** e.g. "file", "cwd", "error", "git", "task", "decision",
   *  "rule", "env", "role", "skill", "subagent", "data", "intent" */
  category: string;
  /** Extracted payload — full data, no truncation */
  data: string;
  /** 1=critical (rules, files, tasks) … 5=low */
  priority: number;
}

export interface ToolCall {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResponse?: string;
  isError?: boolean;
}

/**
 * Hook input shape as received from Claude Code PostToolUse hook stdin.
 * Uses snake_case to match the raw hook JSON.
 */
export interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response?: string;
  /** Optional structured output from the tool (may carry isError) */
  tool_output?: { isError?: boolean };
}

// ── Internal helpers ───────────────────────────────────────────────────────

/** Null-safe string coercion — no truncation, preserves full data. */
function safeString(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value);
}

/** Serialise an unknown value to a string — no truncation. */
function safeStringAny(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

// ── Category extractors ────────────────────────────────────────────────────

/**
 * Category 1 & 2: rule + file
 *
 * CLAUDE.md / .claude/ reads → emit both a "rule" event (priority 1) AND a
 * "file_read" event (priority 1) because the file is being actively accessed.
 *
 * Other Edit/Write/Read tool calls → emit a file_edit / file_write / file_read
 * event (priority 1).
 */
function extractFileAndRule(input: HookInput): SessionEvent[] {
  const { tool_name, tool_input, tool_response } = input;
  const events: SessionEvent[] = [];

  if (tool_name === "Read") {
    const filePath = String(tool_input["file_path"] ?? "");

    // Rule detection: CLAUDE.md or anything inside a .claude/ directory
    const isRuleFile = /CLAUDE\.md$|\.claude[\\/]/i.test(filePath);
    if (isRuleFile) {
      events.push({
        type: "rule",
        category: "rule",
        data: safeString(filePath),
        priority: 1,
      });

      // Capture rule content so it survives context compaction
      if (tool_response && tool_response.length > 0) {
        events.push({
          type: "rule_content",
          category: "rule",
          data: safeString(tool_response),
          priority: 1,
        });
      }
    }

    // Always emit file_read for any Read call
    events.push({
      type: "file_read",
      category: "file",
      data: safeString(filePath),
      priority: 1,
    });

    return events;
  }

  if (tool_name === "Edit") {
    const filePath = String(tool_input["file_path"] ?? "");
    events.push({
      type: "file_edit",
      category: "file",
      data: safeString(filePath),
      priority: 1,
    });
    return events;
  }

  if (tool_name === "NotebookEdit") {
    const notebookPath = String(tool_input["notebook_path"] ?? "");
    events.push({
      type: "file_edit",
      category: "file",
      data: safeString(notebookPath),
      priority: 1,
    });
    return events;
  }', 3, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (3000002, 'untitled (2)', 'if (tool_name === "Write") {
    const filePath = String(tool_input["file_path"] ?? "");
    events.push({
      type: "file_write",
      category: "file",
      data: safeString(filePath),
      priority: 1,
    });
    return events;
  }

  // Glob — file pattern exploration
  if (tool_name === "Glob") {
    const pattern = String(tool_input["pattern"] ?? "");
    events.push({
      type: "file_glob",
      category: "file",
      data: safeString(pattern),
      priority: 3,
    });
    return events;
  }

  // Grep — code search
  if (tool_name === "Grep") {
    const searchPattern = String(tool_input["pattern"] ?? "");
    const searchPath = String(tool_input["path"] ?? "");
    events.push({
      type: "file_search",
      category: "file",
      data: safeString(`${searchPattern} in ${searchPath}`),
      priority: 3,
    });
    return events;
  }

  return events;
}

/**
 * Category 4: cwd
 * Matches the first `cd <path>` in a Bash command (handles quoted paths).
 */
function extractCwd(input: HookInput): SessionEvent[] {
  if (input.tool_name !== "Bash") return [];

  const cmd = String(input.tool_input["command"] ?? "");
  // Match: cd "path" | cd ''path'' | cd path
  const cdMatch = cmd.match(/\bcd\s+("([^"]+)"|''([^'']+)''|(\S+))/);
  if (!cdMatch) return [];

  const dir = cdMatch[2] ?? cdMatch[3] ?? cdMatch[4] ?? "";
  return [{
    type: "cwd",
    category: "cwd",
    data: safeString(dir),
    priority: 2,
  }];
}

/**
 * Category 5: error
 * Detects failures from bash exit codes / error patterns, or an explicit
 * isError flag in tool_output.
 */
function extractError(input: HookInput): SessionEvent[] {
  const { tool_name, tool_input, tool_response, tool_output } = input;

  const response = String(tool_response ?? "");
  const isErrorFlag = tool_output?.isError === true;

  const isBashError =
    tool_name === "Bash" &&
    /exit code [1-9]|error:|Error:|FAIL|failed/i.test(response);

  if (!isBashError && !isErrorFlag) return [];

  return [{
    type: "error_tool",
    category: "error",
    data: safeString(response),
    priority: 2,
  }];
}

/**
 * Category 11: git
 * Matches common git operations from Bash commands.
 */

const GIT_PATTERNS: Array<{ pattern: RegExp; operation: string }> = [
  { pattern: /\bgit\s+checkout\b/, operation: "branch" },
  { pattern: /\bgit\s+commit\b/, operation: "commit" },
  { pattern: /\bgit\s+merge\s+\S+/, operation: "merge" },
  { pattern: /\bgit\s+rebase\b/, operation: "rebase" },
  { pattern: /\bgit\s+stash\b/, operation: "stash" },
  { pattern: /\bgit\s+push\b/, operation: "push" },
  { pattern: /\bgit\s+pull\b/, operation: "pull" },
  { pattern: /\bgit\s+log\b/, operation: "log" },
  { pattern: /\bgit\s+diff\b/, operation: "diff" },
  { pattern: /\bgit\s+status\b/, operation: "status" },
  { pattern: /\bgit\s+branch\b/, operation: "branch" },
  { pattern: /\bgit\s+reset\b/, operation: "reset" },
  { pattern: /\bgit\s+add\b/, operation: "add" },
  { pattern: /\bgit\s+cherry-pick\b/, operation: "cherry-pick" },
  { pattern: /\bgit\s+tag\b/, operation: "tag" },
  { pattern: /\bgit\s+fetch\b/, operation: "fetch" },
  { pattern: /\bgit\s+clone\b/, operation: "clone" },
  { pattern: /\bgit\s+worktree\b/, operation: "worktree" },
];

function extractGit(input: HookInput): SessionEvent[] {
  if (input.tool_name !== "Bash") return [];

  const cmd = String(input.tool_input["command"] ?? "");
  const match = GIT_PATTERNS.find(p => p.pattern.test(cmd));
  if (!match) return [];

  return [{
    type: "git",
    category: "git",
    data: safeString(match.operation),
    priority: 2,
  }];
}

/**
 * Category 3: task
 * TodoWrite / TaskCreate / TaskUpdate tool calls.
 */
function extractTask(input: HookInput): SessionEvent[] {
  const TASK_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"]);
  if (!TASK_TOOLS.has(input.tool_name)) return [];', 3, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (3000003, 'untitled (3)', '// Store tool name as type so create vs update can be reliably distinguished
  const type = input.tool_name === "TaskUpdate" ? "task_update"
    : input.tool_name === "TaskCreate" ? "task_create"
    : "task"; // TodoWrite fallback

  return [{
    type,
    category: "task",
    data: safeString(JSON.stringify(input.tool_input)),
    priority: 1,
  }];
}

/**
 * Category 15: plan
 * Tracks the full plan mode lifecycle:
 * - EnterPlanMode → plan_enter
 * - Write/Edit to ~/.claude/plans/ → plan_file_write
 * - ExitPlanMode → plan_exit (with allowedPrompts)
 * - ExitPlanMode tool_response → plan_approved / plan_rejected
 *
 * Note: Shift+Tab and /plan command do NOT fire PostToolUse hooks
 * (Claude Code bug #15660). Only programmatic EnterPlanMode is tracked.
 */
function extractPlan(input: HookInput): SessionEvent[] {
  if (input.tool_name === "EnterPlanMode") {
    return [{
      type: "plan_enter",
      category: "plan",
      data: "entered plan mode",
      priority: 2,
    }];
  }

  if (input.tool_name === "ExitPlanMode") {
    const events: SessionEvent[] = [];

    // Plan exit event with allowedPrompts detail
    const prompts = input.tool_input["allowedPrompts"];
    const detail = Array.isArray(prompts) && prompts.length > 0
      ? `exited plan mode (allowed: ${safeStringAny(prompts.map((p: unknown) => {
          if (typeof p === "object" && p !== null && "prompt" in p) return String((p as Record<string, unknown>).prompt);
          return String(p);
        }).join(", "))})`
      : "exited plan mode";
    events.push({
      type: "plan_exit",
      category: "plan",
      data: safeString(detail),
      priority: 2,
    });

    // Detect approval/rejection from tool_response
    const response = String(input.tool_response ?? "").toLowerCase();
    if (response.includes("approved") || response.includes("approve")) {
      events.push({
        type: "plan_approved",
        category: "plan",
        data: "plan approved by user",
        priority: 1,
      });
    } else if (response.includes("rejected") || response.includes("decline") || response.includes("denied")) {
      events.push({
        type: "plan_rejected",
        category: "plan",
        data: safeString(`plan rejected: ${input.tool_response ?? ""}`),
        priority: 2,
      });
    }

    return events;
  }

  // Detect plan file writes (Write/Edit to ~/.claude/plans/)
  if (input.tool_name === "Write" || input.tool_name === "Edit") {
    const filePath = String(input.tool_input["file_path"] ?? "");
    if (/[/\\]\.claude[/\\]plans[/\\]/.test(filePath)) {
      return [{
        type: "plan_file_write",
        category: "plan",
        data: safeString(`plan file: ${filePath.split(/[/\\]/).pop() ?? filePath}`),
        priority: 2,
      }];
    }
  }

  return [];
}

/**
 * Category 8: env
 * Environment setup commands in Bash: venv, export, nvm, pyenv, conda, rbenv.
 */

const ENV_PATTERNS: RegExp[] = [
  /\bsource\s+\S*activate\b/,
  /\bexport\s+\w+=/,
  /\bnvm\s+use\b/,
  /\bpyenv\s+(shell|local|global)\b/,
  /\bconda\s+activate\b/,
  /\brbenv\s+(shell|local|global)\b/,
  /\bnpm\s+install\b/,
  /\bnpm\s+ci\b/,
  /\bpip\s+install\b/,
  /\bbun\s+install\b/,
  /\byarn\s+(add|install)\b/,
  /\bpnpm\s+(add|install)\b/,
  /\bcargo\s+(install|add)\b/,
  /\bgo\s+(install|get)\b/,
  /\brustup\b/,
  /\basdf\b/,
  /\bvolta\b/,
  /\bdeno\s+install\b/,
];

function extractEnv(input: HookInput): SessionEvent[] {
  if (input.tool_name !== "Bash") return [];

  const cmd = String(input.tool_input["command"] ?? "");
  const isEnvCmd = ENV_PATTERNS.some(p => p.test(cmd));
  if (!isEnvCmd) return [];

  // Sanitize export commands to prevent secret leakage
  const sanitized = cmd.replace(/\bexport\s+(\w+)=\S*/g, "export $1=***");

  return [{
    type: "env",
    category: "env",
    data: safeString(sanitized),
    priority: 2,
  }];
}

/**
 * Category 10: skill
 * Skill tool invocations.
 */
function extractSkill(input: HookInput): SessionEvent[] {
  if (input.tool_name !== "Skill") return [];', 3, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (3000004, 'untitled (4)', 'const skillName = String(input.tool_input["skill"] ?? "");
  return [{
    type: "skill",
    category: "skill",
    data: safeString(skillName),
    priority: 3,
  }];
}

/**
 * Category 9: subagent
 * Agent tool calls — tracks both launch and completion.
 * When tool_response is present, the agent has completed and the result
 * is captured at higher priority (P2) so it survives budget trimming.
 */
function extractSubagent(input: HookInput): SessionEvent[] {
  if (input.tool_name !== "Agent") return [];

  const prompt = safeString(String(input.tool_input["prompt"] ?? input.tool_input["description"] ?? ""));
  const response = input.tool_response ? safeString(String(input.tool_response)) : "";
  const isCompleted = response.length > 0;

  return [{
    type: isCompleted ? "subagent_completed" : "subagent_launched",
    category: "subagent",
    data: isCompleted
      ? safeString(`[completed] ${prompt} → ${response}`)
      : safeString(`[launched] ${prompt}`),
    priority: isCompleted ? 2 : 3,
  }];
}

/**
 * Category 14: mcp
 * MCP tool calls (context7, playwright, claude-mem, ctx-stats, etc.).
 */
function extractMcp(input: HookInput): SessionEvent[] {
  const { tool_name, tool_input } = input;
  if (!tool_name.startsWith("mcp__")) return [];

  // Extract readable tool name: last segment after __
  const parts = tool_name.split("__");
  const toolShort = parts[parts.length - 1] || tool_name;

  // Extract first string argument for context
  const firstArg = Object.values(tool_input).find((v): v is string => typeof v === "string");
  const argStr = firstArg ? `: ${safeString(String(firstArg))}` : "";

  return [{
    type: "mcp",
    category: "mcp",
    data: safeString(`${toolShort}${argStr}`),
    priority: 3,
  }];
}

/**
 * Category 6 (tool-based): decision
 * AskUserQuestion tool — tracks questions posed to user and their answers.
 */
function extractDecision(input: HookInput): SessionEvent[] {
  if (input.tool_name !== "AskUserQuestion") return [];

  const questions = input.tool_input["questions"];
  const questionText = Array.isArray(questions) && questions.length > 0
    ? String((questions[0] as Record<string, unknown>)["question"] ?? "")
    : "";

  const answer = safeString(String(input.tool_response ?? ""));
  const summary = questionText
    ? `Q: ${safeString(questionText)} → A: ${answer}`
    : `answer: ${answer}`;

  return [{
    type: "decision_question",
    category: "decision",
    data: safeString(summary),
    priority: 2,
  }];
}

/**
 * Category 8: env (worktree)
 * EnterWorktree tool — tracks worktree creation.
 */
function extractWorktree(input: HookInput): SessionEvent[] {
  if (input.tool_name !== "EnterWorktree") return [];

  const name = String(input.tool_input["name"] ?? "unnamed");
  return [{
    type: "worktree",
    category: "env",
    data: safeString(`entered worktree: ${name}`),
    priority: 2,
  }];
}

// ── User-message extractors ────────────────────────────────────────────────

/**
 * Category 6: decision
 * User corrections / approach selections.
 */

const DECISION_PATTERNS: RegExp[] = [
  /\b(don''?t|do not|never|always|instead|rather|prefer)\b/i,
  /\b(use|switch to|go with|pick|choose)\s+\w+\s+(instead|over|not)\b/i,
  /\b(no,?\s+(use|do|try|make))\b/i,
  // Turkish patterns
  /\b(hayır|hayir|evet|böyle|boyle|degil|değil|yerine|kullan)\b/i,
];

function extractUserDecision(message: string): SessionEvent[] {
  const isDecision = DECISION_PATTERNS.some(p => p.test(message));
  if (!isDecision) return [];

  return [{
    type: "decision",
    category: "decision",
    data: safeString(message),
    priority: 2,
  }];
}

/**
 * Category 7: role
 * Persona / behavioral directive patterns.
 */

const ROLE_PATTERNS: RegExp[] = [
  /\b(act as|you are|behave like|pretend|role of|persona)\b/i,
  /\b(senior|staff|principal|lead)\s+(engineer|developer|architect)\b/i,
  // Turkish patterns
  /\b(gibi davran|rolünde|olarak çalış)\b/i,
];', 3, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (3000005, 'untitled (5)', 'function extractRole(message: string): SessionEvent[] {
  const isRole = ROLE_PATTERNS.some(p => p.test(message));
  if (!isRole) return [];

  return [{
    type: "role",
    category: "role",
    data: safeString(message),
    priority: 3,
  }];
}

/**
 * Category 13: intent
 * Session mode classification from user messages.
 */

const INTENT_PATTERNS: Array<{ mode: string; pattern: RegExp }> = [
  { mode: "investigate", pattern: /\b(why|how does|explain|understand|what is|analyze|debug|look into)\b/i },
  { mode: "implement",   pattern: /\b(create|add|build|implement|write|make|develop|fix)\b/i },
  { mode: "discuss",     pattern: /\b(think about|consider|should we|what if|pros and cons|opinion)\b/i },
  { mode: "review",      pattern: /\b(review|check|audit|verify|test|validate)\b/i },
];

function extractIntent(message: string): SessionEvent[] {
  const match = INTENT_PATTERNS.find(({ pattern }) => pattern.test(message));
  if (!match) return [];

  return [{
    type: "intent",
    category: "intent",
    data: safeString(match.mode),
    priority: 4,
  }];
}

/**
 * Category 12: data
 * Large user-pasted data references (message > 1KB).
 */
function extractData(message: string): SessionEvent[] {
  if (message.length <= 1024) return [];

  return [{
    type: "data",
    category: "data",
    data: safeString(message),
    priority: 4,
  }];
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract session events from a PostToolUse hook input.
 *
 * Accepts the raw hook JSON shape (snake_case keys) as received from stdin.
 * Returns an array of zero or more SessionEvents. Never throws.
 */
export function extractEvents(input: HookInput): SessionEvent[] {
  try {
    const events: SessionEvent[] = [];

    // File + Rule (handles Read/Edit/Write)
    events.push(...extractFileAndRule(input));

    // Bash-based extractors (may overlap on the same command)
    events.push(...extractCwd(input));
    events.push(...extractError(input));
    events.push(...extractGit(input));
    events.push(...extractEnv(input));

    // Tool-specific extractors
    events.push(...extractTask(input));
    events.push(...extractPlan(input));
    events.push(...extractSkill(input));
    events.push(...extractSubagent(input));
    events.push(...extractMcp(input));
    events.push(...extractDecision(input));
    events.push(...extractWorktree(input));

    return events;
  } catch {
    // Graceful degradation: if extraction fails, session continues normally
    return [];
  }
}

/**
 * Extract session events from a UserPromptSubmit hook input (user message text).
 *
 * Handles: decision, role, intent, data categories.
 * Returns an array of zero or more SessionEvents. Never throws.
 */
export function extractUserEvents(message: string): SessionEvent[] {
  try {
    const events: SessionEvent[] = [];

    events.push(...extractUserDecision(message));
    events.push(...extractRole(message));
    events.push(...extractIntent(message));
    events.push(...extractData(message));

    return events;
  } catch {
    return [];
  }
}', 3, 'prose');
-- src/session/snapshot.ts: 4 chunks
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (4000001, 'untitled (1)', '/**
 * Snapshot builder — converts stored SessionEvents into a reference-based
 * XML resume snapshot.
 *
 * Pure functions only. No database access, no file system, no side effects.
 *
 * The output XML is injected into the LLM''s context after a compact event to
 * restore session awareness. Instead of truncated inline data, each section
 * contains a natural summary plus a runnable search tool call that retrieves
 * full details from the indexed knowledge base on demand.
 *
 * Zero truncation. Zero information loss. Full data lives in SessionDB;
 * the snapshot is a table of contents.
 */

import { escapeXML } from "../truncate.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Stored event as read from SessionDB. */
export interface StoredEvent {
  type: string;
  category: string;
  data: string;
  priority: number;
  created_at?: string;
}

export interface BuildSnapshotOpts {
  maxBytes?: number;      // KEPT for backward compat but IGNORED
  compactCount?: number;
  searchTool?: string;    // platform-specific tool name, default "ctx_search"
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MAX_ACTIVE_FILES = 10;

/**
 * Extract 2-4 keyword phrases from a list of strings for BM25 search queries.
 * Takes actual data values and picks representative terms.
 */
function buildQueries(items: string[], maxQueries = 4): string[] {
  const unique = [...new Set(items.filter(s => s.length > 0))];
  const selected = unique.slice(0, maxQueries);
  return selected.map(s => {
    // Take the first ~80 chars as a query — enough for BM25 matching
    const trimmed = s.length > 80 ? s.slice(0, 80) : s;
    return trimmed;
  });
}

/**
 * Format a runnable tool call block for a section.
 */
function toolCall(toolName: string, queries: string[]): string {
  if (queries.length === 0) return "";
  const escaped = queries.map(q => `"${escapeXML(q)}"`).join(", ");
  return `\n    For full details:\n    ${escapeXML(toolName)}(\n      queries: [${escaped}],\n      source: "session-events"\n    )`;
}

// ── Section builders ─────────────────────────────────────────────────────────

function buildFilesSection(fileEvents: StoredEvent[], searchTool: string): string {
  if (fileEvents.length === 0) return "";

  // Build per-file operation counts
  const fileMap = new Map<string, { ops: Map<string, number> }>();

  for (const ev of fileEvents) {
    const path = ev.data;
    let entry = fileMap.get(path);
    if (!entry) {
      entry = { ops: new Map() };
      fileMap.set(path, entry);
    }

    let op: string;
    if (ev.type === "file_write") op = "write";
    else if (ev.type === "file_read") op = "read";
    else if (ev.type === "file_edit") op = "edit";
    else op = ev.type;

    entry.ops.set(op, (entry.ops.get(op) ?? 0) + 1);
  }

  // Limit to last MAX_ACTIVE_FILES files (by insertion order = chronological)
  const entries = Array.from(fileMap.entries());
  const limited = entries.slice(-MAX_ACTIVE_FILES);

  const summaryLines: string[] = [];
  const queryTerms: string[] = [];

  for (const [path, { ops }] of limited) {
    const opsStr = Array.from(ops.entries())
      .map(([k, v]) => `${k}×${v}`)
      .join(", ");
    // Use just the filename for concise display
    const fileName = path.split("/").pop() ?? path;
    summaryLines.push(`    ${escapeXML(fileName)} (${escapeXML(opsStr)})`);
    queryTerms.push(`${fileName} ${Array.from(ops.keys()).join(" ")}`);
  }', 4, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (4000002, 'untitled (2)', 'const queries = buildQueries(queryTerms);
  const lines = [
    `  <files count="${fileMap.size}">`,
    ...summaryLines,
    toolCall(searchTool, queries),
    `  </files>`,
  ];
  return lines.join("\n");
}

function buildErrorsSection(errorEvents: StoredEvent[], searchTool: string): string {
  if (errorEvents.length === 0) return "";

  const summaryLines: string[] = [];
  const queryTerms: string[] = [];

  for (const ev of errorEvents) {
    summaryLines.push(`    ${escapeXML(ev.data)}`);
    queryTerms.push(ev.data);
  }

  const queries = buildQueries(queryTerms);
  const lines = [
    `  <errors count="${errorEvents.length}">`,
    ...summaryLines,
    toolCall(searchTool, queries),
    `  </errors>`,
  ];
  return lines.join("\n");
}

function buildDecisionsSection(decisionEvents: StoredEvent[], searchTool: string): string {
  if (decisionEvents.length === 0) return "";

  const seen = new Set<string>();
  const summaryLines: string[] = [];
  const queryTerms: string[] = [];

  for (const ev of decisionEvents) {
    if (seen.has(ev.data)) continue;
    seen.add(ev.data);
    summaryLines.push(`    ${escapeXML(ev.data)}`);
    queryTerms.push(ev.data);
  }

  if (summaryLines.length === 0) return "";

  const queries = buildQueries(queryTerms);
  const lines = [
    `  <decisions count="${summaryLines.length}">`,
    ...summaryLines,
    toolCall(searchTool, queries),
    `  </decisions>`,
  ];
  return lines.join("\n");
}

function buildRulesSection(ruleEvents: StoredEvent[], searchTool: string): string {
  if (ruleEvents.length === 0) return "";

  const seen = new Set<string>();
  const summaryLines: string[] = [];
  const queryTerms: string[] = [];

  for (const ev of ruleEvents) {
    if (seen.has(ev.data)) continue;
    seen.add(ev.data);

    if (ev.type === "rule_content") {
      summaryLines.push(`    ${escapeXML(ev.data)}`);
    } else {
      summaryLines.push(`    ${escapeXML(ev.data)}`);
    }
    queryTerms.push(ev.data);
  }

  if (summaryLines.length === 0) return "";

  const queries = buildQueries(queryTerms);
  const lines = [
    `  <rules count="${summaryLines.length}">`,
    ...summaryLines,
    toolCall(searchTool, queries),
    `  </rules>`,
  ];
  return lines.join("\n");
}

function buildGitSection(gitEvents: StoredEvent[], searchTool: string): string {
  if (gitEvents.length === 0) return "";

  const summaryLines: string[] = [];
  const queryTerms: string[] = [];

  for (const ev of gitEvents) {
    summaryLines.push(`    ${escapeXML(ev.data)}`);
    queryTerms.push(ev.data);
  }

  const queries = buildQueries(queryTerms);
  const lines = [
    `  <git count="${gitEvents.length}">`,
    ...summaryLines,
    toolCall(searchTool, queries),
    `  </git>`,
  ];
  return lines.join("\n");
}

/**
 * Render <task_state> from task events.
 * Reconstructs the full task list from create/update events,
 * filters out completed tasks, and renders only pending/in-progress work.
 *
 * TaskCreate events have `{ subject }`, TaskUpdate events have `{ taskId, status }`.
 * Match by chronological order: creates[0] -> lowest taskId from updates.
 */
export function renderTaskState(taskEvents: StoredEvent[]): string {
  if (taskEvents.length === 0) return "";

  const creates: string[] = [];
  const updates: Record<string, string> = {};

  for (const ev of taskEvents) {
    try {
      const parsed = JSON.parse(ev.data) as Record<string, unknown>;
      if (typeof parsed.subject === "string") {
        creates.push(parsed.subject);
      } else if (typeof parsed.taskId === "string" && typeof parsed.status === "string") {
        updates[parsed.taskId] = parsed.status;
      }
    } catch { /* not JSON */ }
  }

  if (creates.length === 0) return "";

  const DONE = new Set(["completed", "deleted", "failed"]);

  // Match creates to updates positionally (creates[0] -> lowest taskId)
  const sortedIds = Object.keys(updates).sort((a, b) => Number(a) - Number(b));', 4, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (4000003, 'untitled (3)', 'const pending: string[] = [];
  for (let i = 0; i < creates.length; i++) {
    const matchedId = sortedIds[i];
    const status = matchedId ? (updates[matchedId] ?? "pending") : "pending";
    if (!DONE.has(status)) {
      pending.push(creates[i]);
    }
  }

  // All tasks completed — nothing to render
  if (pending.length === 0) return "";

  const lines: string[] = [];
  for (const task of pending) {
    lines.push(`    [pending] ${escapeXML(task)}`);
  }
  return lines.join("\n");
}

function buildTaskSection(taskEvents: StoredEvent[], searchTool: string): string {
  const taskContent = renderTaskState(taskEvents);
  if (!taskContent) return "";

  const queryTerms: string[] = [];
  for (const ev of taskEvents) {
    try {
      const parsed = JSON.parse(ev.data) as Record<string, unknown>;
      if (typeof parsed.subject === "string") {
        queryTerms.push(parsed.subject);
      }
    } catch { /* not JSON */ }
  }

  const queries = buildQueries(queryTerms);
  const pendingCount = taskContent.split("\n").length;

  const lines = [
    `  <task_state count="${pendingCount}">`,
    taskContent,
    toolCall(searchTool, queries),
    `  </task_state>`,
  ];
  return lines.join("\n");
}

function buildEnvironmentSection(
  cwdEvents: StoredEvent[],
  envEvents: StoredEvent[],
  searchTool: string,
): string {
  if (cwdEvents.length === 0 && envEvents.length === 0) return "";

  const summaryLines: string[] = [];
  const queryTerms: string[] = [];

  if (cwdEvents.length > 0) {
    const lastCwd = cwdEvents[cwdEvents.length - 1];
    summaryLines.push(`    cwd: ${escapeXML(lastCwd.data)}`);
    queryTerms.push("working directory");
  }

  for (const env of envEvents) {
    summaryLines.push(`    ${escapeXML(env.data)}`);
    queryTerms.push(env.data);
  }

  const queries = buildQueries(queryTerms);
  const lines = [
    `  <environment>`,
    ...summaryLines,
    toolCall(searchTool, queries),
    `  </environment>`,
  ];
  return lines.join("\n");
}

function buildSubagentsSection(subagentEvents: StoredEvent[], searchTool: string): string {
  if (subagentEvents.length === 0) return "";

  const summaryLines: string[] = [];
  const queryTerms: string[] = [];

  for (const ev of subagentEvents) {
    const status = ev.type === "subagent_completed" ? "completed"
      : ev.type === "subagent_launched" ? "launched"
      : "unknown";
    summaryLines.push(`    [${status}] ${escapeXML(ev.data)}`);
    queryTerms.push(`subagent ${ev.data}`);
  }

  const queries = buildQueries(queryTerms);
  const lines = [
    `  <subagents count="${subagentEvents.length}">`,
    ...summaryLines,
    toolCall(searchTool, queries),
    `  </subagents>`,
  ];
  return lines.join("\n");
}

function buildSkillsSection(skillEvents: StoredEvent[], searchTool: string): string {
  if (skillEvents.length === 0) return "";

  // Count invocations per skill name
  const skillCounts = new Map<string, number>();
  for (const ev of skillEvents) {
    const name = ev.data.split(":")[0].trim();
    skillCounts.set(name, (skillCounts.get(name) ?? 0) + 1);
  }

  const summaryLines: string[] = [];
  const queryTerms: string[] = [];

  for (const [name, count] of skillCounts) {
    summaryLines.push(`    ${escapeXML(name)} (${count}×)`);
    queryTerms.push(`skill ${name} invocation`);
  }

  const queries = buildQueries(queryTerms);
  const lines = [
    `  <skills count="${skillEvents.length}">`,
    ...summaryLines,
    toolCall(searchTool, queries),
    `  </skills>`,
  ];
  return lines.join("\n");
}

function buildIntentSection(intentEvents: StoredEvent[]): string {
  if (intentEvents.length === 0) return "";
  const lastIntent = intentEvents[intentEvents.length - 1];
  return `  <intent mode="${escapeXML(lastIntent.data)}"/>`;
}

// ── Main builder ─────────────────────────────────────────────────────────────', 4, 'prose');
INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (4000004, 'untitled (4)', '/**
 * Build a reference-based resume snapshot XML string from stored session events.
 *
 * Algorithm:
 * 1. Group events by category
 * 2. For each non-empty category, build a summary section with a runnable
 *    search tool call containing exact queries for full details
 * 3. Assemble ALL non-empty sections — no priority dropping, no byte budget
 */
export function buildResumeSnapshot(
  events: StoredEvent[],
  opts?: BuildSnapshotOpts,
): string {
  const compactCount = opts?.compactCount ?? 1;
  const searchTool = opts?.searchTool ?? "ctx_search";
  const now = new Date().toISOString();

  // ── Group events by category ──
  const fileEvents: StoredEvent[] = [];
  const taskEvents: StoredEvent[] = [];
  const ruleEvents: StoredEvent[] = [];
  const decisionEvents: StoredEvent[] = [];
  const cwdEvents: StoredEvent[] = [];
  const errorEvents: StoredEvent[] = [];
  const envEvents: StoredEvent[] = [];
  const gitEvents: StoredEvent[] = [];
  const subagentEvents: StoredEvent[] = [];
  const intentEvents: StoredEvent[] = [];
  const skillEvents: StoredEvent[] = [];

  for (const ev of events) {
    switch (ev.category) {
      case "file": fileEvents.push(ev); break;
      case "task": taskEvents.push(ev); break;
      case "rule": ruleEvents.push(ev); break;
      case "decision": decisionEvents.push(ev); break;
      case "cwd": cwdEvents.push(ev); break;
      case "error": errorEvents.push(ev); break;
      case "env": envEvents.push(ev); break;
      case "git": gitEvents.push(ev); break;
      case "subagent": subagentEvents.push(ev); break;
      case "intent": intentEvents.push(ev); break;
      case "skill": skillEvents.push(ev); break;
    }
  }

  // ── Build all sections ──
  const sections: string[] = [];

  // How-to-search instruction block (always present)
  sections.push(`  <how_to_search>
  Each section below contains a summary of prior work.
  For FULL DETAILS, run the exact tool call shown under each section.
  Do NOT ask the user to re-explain prior work. Search first.
  Do NOT invent your own queries — use the ones provided.
  </how_to_search>`);

  const files = buildFilesSection(fileEvents, searchTool);
  if (files) sections.push(files);

  const errors = buildErrorsSection(errorEvents, searchTool);
  if (errors) sections.push(errors);

  const decisions = buildDecisionsSection(decisionEvents, searchTool);
  if (decisions) sections.push(decisions);

  const rules = buildRulesSection(ruleEvents, searchTool);
  if (rules) sections.push(rules);

  const git = buildGitSection(gitEvents, searchTool);
  if (git) sections.push(git);

  const tasks = buildTaskSection(taskEvents, searchTool);
  if (tasks) sections.push(tasks);

  const environment = buildEnvironmentSection(cwdEvents, envEvents, searchTool);
  if (environment) sections.push(environment);

  const subagents = buildSubagentsSection(subagentEvents, searchTool);
  if (subagents) sections.push(subagents);

  const skills = buildSkillsSection(skillEvents, searchTool);
  if (skills) sections.push(skills);

  const intent = buildIntentSection(intentEvents);
  if (intent) sections.push(intent);

  // ── Assemble ──
  const header = `<session_resume events="${events.length}" compact_count="${compactCount}" generated_at="${now}">`;
  const footer = `</session_resume>`;

  const body = sections.join("\n\n");
  if (body) {
    return `${header}\n\n${body}\n\n${footer}`;
  }
  return `${header}\n${footer}`;
}', 4, 'prose');
SELECT count(*) FROM chunks;
