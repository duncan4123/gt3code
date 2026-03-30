/**
 * DoltliteClient — Drop-in replacement for NodeSqliteClient that uses
 * better-sqlite3 linked against libdoltlite.a instead of node:sqlite.
 *
 * Doltlite adds git-like versioning (dolt_commit, dolt_log, dolt_branch,
 * dolt_diff_*, dolt_history_*) and FTS5 to SQLite's prolly-tree storage.
 *
 * API differences from node:sqlite → better-sqlite3:
 *   statement.columns().length > 0  →  statement.reader
 *   statement.setReadBigInts(bool)  →  statement.safeIntegers(bool)
 *   statement.setReturnArrays(bool) →  statement.raw(bool)
 */
import { createRequire } from "node:module";

import * as Cache from "effect/Cache";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as ServiceMap from "effect/ServiceMap";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { SqlError, classifySqliteError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

export const TypeId: TypeId = "~local/doltlite/DoltliteClient";
export type TypeId = "~local/doltlite/DoltliteClient";

export const DoltliteClient = ServiceMap.Service<Client.SqlClient>("t3/persistence/DoltliteClient");

export interface DoltliteClientConfig {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly prepareCacheSize?: number | undefined;
  readonly prepareCacheTTL?: Duration.Input | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
  /** Apply WAL mode pragmas on open (recommended, default true) */
  readonly wal?: boolean | undefined;
}

// ─── better-sqlite3 types (minimal surface we need) ───────────────────────

interface BetterStatement {
  readonly reader: boolean;
  safeIntegers(enabled: boolean): this;
  raw(enabled: boolean): this;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

interface BetterDatabase {
  prepare(sql: string): BetterStatement;
  exec(sql: string): this;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  close(): void;
}

type BetterDatabaseConstructor = new (
  filename: string,
  options?: { readonly?: boolean; timeout?: number },
) => BetterDatabase;

// Lazy-load better-sqlite3 (linked against libdoltlite.a)
let _Database: BetterDatabaseConstructor | null = null;
function loadDatabase(): BetterDatabaseConstructor {
  if (!_Database) {
    const require = createRequire(import.meta.url);
    _Database = require("better-sqlite3") as BetterDatabaseConstructor;
  }
  return _Database!;
}

function openDB(filename: string, options: DoltliteClientConfig): BetterDatabase {
  const Database = loadDatabase();
  const db = new Database(filename, {
    readonly: options.readonly ?? false,
    timeout: 5000,
  });
  if (options.wal !== false) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  return db;
}

function hasRows(statement: BetterStatement): boolean {
  return statement.reader;
}

// ─── Core client factory ────────────────────────────────────────────────────

const makeWithDatabase = (
  options: DoltliteClientConfig,
  openDatabase: () => BetterDatabase,
): Effect.Effect<Client.SqlClient, never, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined;

    const makeConnection = Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const db = openDatabase();
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => db.close()),
      );

      const prepareCache = yield* Cache.make({
        capacity: options.prepareCacheSize ?? 200,
        timeToLive: options.prepareCacheTTL ?? Duration.minutes(10),
        lookup: (sql: string) =>
          Effect.try({
            try: () => db.prepare(sql),
            catch: (cause) =>
              new SqlError({
                reason: classifySqliteError(cause, {
                  message: "Failed to prepare statement",
                  operation: "prepare",
                }),
              }),
          }),
      });

      const runStatement = (
        statement: BetterStatement,
        params: ReadonlyArray<unknown>,
        raw: boolean,
      ) =>
        Effect.withFiber<ReadonlyArray<any>, SqlError>((fiber) => {
          // better-sqlite3: safeIntegers() replaces setReadBigInts()
          statement.safeIntegers(Boolean(ServiceMap.get(fiber.services, Client.SafeIntegers)));
          try {
            if (hasRows(statement)) {
              return Effect.succeed(statement.all(...params));
            }
            const result = statement.run(...params);
            return Effect.succeed(raw ? ([result] as unknown as ReadonlyArray<any>) : []);
          } catch (cause) {
            return Effect.fail(
              new SqlError({
                reason: classifySqliteError(cause, {
                  message: "Failed to execute statement",
                  operation: "execute",
                }),
              }),
            );
          }
        });

      const run = (sql: string, params: ReadonlyArray<unknown>, raw = false) =>
        Effect.flatMap(Cache.get(prepareCache, sql), (s) => runStatement(s, params, raw));

      const runValues = (sql: string, params: ReadonlyArray<unknown>) =>
        Effect.acquireUseRelease(
          Cache.get(prepareCache, sql),
          (statement) =>
            Effect.try({
              try: () => {
                if (hasRows(statement)) {
                  // better-sqlite3: raw() replaces setReturnArrays()
                  statement.raw(true);
                  return statement.all(...params) as unknown as ReadonlyArray<
                    ReadonlyArray<unknown>
                  >;
                }
                statement.run(...params);
                return [];
              },
              catch: (cause) =>
                new SqlError({
                  reason: classifySqliteError(cause, {
                    message: "Failed to execute statement",
                    operation: "execute",
                  }),
                }),
            }),
          (statement) =>
            Effect.sync(() => {
              if (hasRows(statement)) {
                statement.raw(false);
              }
            }),
        );

      return identity<Connection>({
        execute(sql, params, rowTransform) {
          return rowTransform ? Effect.map(run(sql, params), rowTransform) : run(sql, params);
        },
        executeRaw(sql, params) {
          return run(sql, params, true);
        },
        executeValues(sql, params) {
          return runValues(sql, params);
        },
        executeUnprepared(sql, params, rowTransform) {
          const effect = runStatement(db.prepare(sql), params ?? [], false);
          return rowTransform ? Effect.map(effect, rowTransform) : effect;
        },
        executeStream(_sql, _params) {
          return Stream.die("executeStream not implemented");
        },
      });
    });

    const semaphore = yield* Semaphore.make(1);
    const connection = yield* makeConnection;

    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection));
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!;
      const scope = ServiceMap.getUnsafe(fiber.services, Scope.Scope);
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () =>
          Scope.addFinalizer(scope, semaphore.release(1)),
        ),
        connection,
      );
    });

    return yield* Client.make({
      acquirer,
      compiler,
      transactionAcquirer,
      spanAttributes: [
        ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
        [ATTR_DB_SYSTEM_NAME, "doltlite"],
      ],
      transformRows,
    });
  });

// ─── Public layer constructors ──────────────────────────────────────────────

export const layer = (config: DoltliteClientConfig): Layer.Layer<Client.SqlClient> =>
  Layer.effectServices(
    Effect.map(
      makeWithDatabase(config, () => openDB(config.filename, config)),
      (client) =>
        ServiceMap.make(DoltliteClient, client).pipe(ServiceMap.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layerConfig = (
  config: Config.Wrap<DoltliteClientConfig>,
): Layer.Layer<Client.SqlClient, Config.ConfigError> =>
  Layer.effectServices(
    Config.unwrap(config)
      .asEffect()
      .pipe(
        Effect.flatMap((opts) => makeWithDatabase(opts, () => openDB(opts.filename, opts))),
        Effect.map((client) =>
          ServiceMap.make(DoltliteClient, client).pipe(ServiceMap.add(Client.SqlClient, client)),
        ),
      ),
  ).pipe(Layer.provide(Reactivity.layer));
