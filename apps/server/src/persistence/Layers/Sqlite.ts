import { Effect, Layer, FileSystem, Path } from "effect";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { existsSync } from "node:fs";
import { DatabaseSync as NodeSqliteDb } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMigrations } from "../Migrations.ts";
import { ServerConfig } from "../../config.ts";
import { layer } from "../NodeSqliteClient.ts";

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly spanAttributes?: Record<string, unknown>;
};

const makeRuntimeSqliteLayer = (
  config: RuntimeSqliteLayerConfig,
): Layer.Layer<SqlClient.SqlClient> => layer(config);

/**
 * Derive the projection sidecar path from the main DB path.
 * e.g. `state.sqlite` → `state-proj.sqlite`
 */
export const projDbPath = (mainDbPath: string): string =>
  mainDbPath.replace(/\.sqlite$/, "-proj.sqlite");

/**
 * Ensure the projection sidecar file exists with a standard SQLite header.
 * Doltlite's sqlite3BtreeOpen auto-detects the file format: files with the
 * standard "SQLite format 3\0" header route to the original btree pager,
 * avoiding prolly-tree overhead for high-write projection tables.
 */
const ensureBtreeFile = (path: string): void => {
  if (existsSync(path)) return;
  const db = new NodeSqliteDb(path);
  db.exec("CREATE TABLE _init(x); DROP TABLE _init;");
  db.close();
};

const makeSetup = (projPath: string | null) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA foreign_keys = ON;`;

      if (projPath) {
        ensureBtreeFile(projPath);
        yield* sql.unsafe(`ATTACH DATABASE '${projPath}' AS proj`);
        yield* Effect.logInfo(`attached projection sidecar: ${projPath}`);
      }

      yield* runMigrations();
    }),
  );

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  const projPath = projDbPath(dbPath);

  return Layer.provideMerge(
    makeSetup(projPath),
    makeRuntimeSqliteLayer({
      filename: dbPath,
      spanAttributes: {
        "db.name": path.basename(dbPath),
        "service.name": "t3-server",
      },
    }),
  );
}, Layer.unwrap);

const memorySetup = Layer.effectDiscard(
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON;`;
    const tempDir = mkdtempSync(join(tmpdir(), "t3-proj-"));
    const projPath = join(tempDir, "proj.sqlite");
    ensureBtreeFile(projPath);
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => rmSync(tempDir, { recursive: true, force: true })),
    );
    yield* sql.unsafe(`ATTACH DATABASE '${projPath}' AS proj`);
    yield* runMigrations();
  }),
);

export const SqlitePersistenceMemory = Layer.provideMerge(
  memorySetup,
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);
