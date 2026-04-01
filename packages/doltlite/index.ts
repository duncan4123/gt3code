/**
 * doltlite — node:sqlite-compatible API backed by libdoltlite.a
 *
 * Drop-in replacement: change `import { DatabaseSync } from "node:sqlite"`
 * to `import { DatabaseSync } from "doltlite"`. Everything else stays the same.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3");

export class StatementSync {
  #inner: any;

  constructor(inner: any) {
    this.#inner = inner;
  }

  columns(): Array<{ name: string; type: string | null }> {
    return this.#inner.reader ? this.#inner.columns() : [];
  }

  setReadBigInts(enabled: boolean): void {
    this.#inner.safeIntegers(enabled);
  }

  setReturnArrays(enabled: boolean): void {
    this.#inner.raw(enabled);
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    return this.#inner.run(...params);
  }

  all(...params: unknown[]): unknown[] {
    return this.#inner.all(...params);
  }

  get(...params: unknown[]): unknown {
    const result = this.#inner.get(...params);
    return result === undefined ? undefined : result;
  }

  iterate(...params: unknown[]): IterableIterator<unknown> {
    return this.#inner.iterate(...params);
  }
}

export class DatabaseSync {
  #db: any;

  constructor(path: string, options?: { readonly?: boolean; allowExtension?: boolean }) {
    this.#db = new BetterSqlite3(path, {
      readonly: options?.readonly ?? false,
      timeout: 5000,
    });
    // Doltlite manages its own WAL via pager shim — skip explicit WAL pragma.
    // PASSIVE checkpoint on close to avoid GC compaction corruption.
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this.#db.prepare(sql));
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    return this.#db.pragma(source, options);
  }

  close(): void {
    try {
      this.#db.pragma("wal_checkpoint(PASSIVE)");
    } catch { /* best-effort */ }
    this.#db.close();
  }
}
