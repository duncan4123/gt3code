import * as FileSystem from "effect/FileSystem";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { DatabaseSync as NodeSqliteDb } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMigrations } from "../Migrations.ts";
import { ensureHotSidecarSchema } from "../Migrations/038_MoveHotTablesToBtreeSidecar.ts";
import { ensureGcLookupTables } from "../Migrations/039_GcLookupTables.ts";
import { ServerConfig } from "../../config.ts";
import { layer } from "../NodeSqliteClient.ts";

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly spanAttributes?: Record<string, unknown>;
};

const makeRuntimeSqliteLayer = (
  config: RuntimeSqliteLayerConfig,
): Layer.Layer<SqlClient.SqlClient> => layer(config);

export const projDbPath = (mainDbPath: string): string =>
  mainDbPath.replace(/\.sqlite$/, "-proj.sqlite");

const ensureBtreeFile = (path: string): void => {
  if (existsSync(path)) {
    const header = readFileSync(path, { encoding: null, flag: "r" }).subarray(0, 16);
    if (header.equals(Buffer.from("SQLite format 3\0", "binary"))) {
      return;
    }
    rmSync(path, { force: true });
  }
  const db = new NodeSqliteDb(path);
  db.exec("CREATE TABLE _init(x); DROP TABLE _init;");
  db.close();
};

const escapeSqliteStringLiteral = (value: string): string => value.replaceAll("'", "''");

const makeSetup = (projPath: string | null) =>
  Layer.effectDiscard(Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON;`;

    if (projPath) {
      ensureBtreeFile(projPath);
      yield* sql.unsafe(`ATTACH DATABASE '${escapeSqliteStringLiteral(projPath)}' AS proj`);
      yield* Effect.logInfo(`attached projection sidecar: ${projPath}`);
    }

    yield* runMigrations();
    if (projPath) {
      yield* ensureHotSidecarSchema;
    }
    yield* ensureGcLookupTables;
  }));

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
    const tempDir = mkdtempSync(join(tmpdir(), "t3-proj-"));
    const projPath = join(tempDir, "proj.sqlite");
    ensureBtreeFile(projPath);
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => rmSync(tempDir, { recursive: true, force: true })),
    );

    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* sql.unsafe(`ATTACH DATABASE '${escapeSqliteStringLiteral(projPath)}' AS proj`);
    yield* runMigrations();
    yield* ensureHotSidecarSchema;
    yield* ensureGcLookupTables;
  }),
);

export const SqlitePersistenceMemory = Layer.provideMerge(
  memorySetup,
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);
