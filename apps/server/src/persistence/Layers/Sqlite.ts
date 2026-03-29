import { Effect, Layer, FileSystem, Path } from "effect";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMigrations } from "../Migrations.ts";
import { ServerConfig } from "../../config.ts";
import { layer as doltliteLayer } from "../DoltliteClient.ts";

const makeRuntimeSqliteLayer = (config: {
  readonly filename: string;
}): Layer.Layer<SqlClient.SqlClient> => doltliteLayer({ ...config, wal: false });

/**
 * Derive the FTS btree sidecar path from the main DB path.
 * e.g. `/home/user/.t3/userdata/state.sqlite` → `state-fts.sqlite`
 */
export const ftsDbPath = (mainDbPath: string): string =>
  mainDbPath.replace(/\.sqlite$/, "-fts.sqlite");

/**
 * Ensure the FTS btree sidecar file exists with a standard SQLite header.
 * Doltlite's ATTACH auto-detects the file format from the header — a file
 * seeded by `sqlite3` CLI gets the btree pager, avoiding prolly-tree FTS5
 * corruption (timsehn/doltlite FTS5 blob corruption bug).
 */
const ensureFtsBtreeFile = (ftsPath: string): void => {
  if (existsSync(ftsPath)) return;
  execSync(`sqlite3 ${JSON.stringify(ftsPath)} "CREATE TABLE _seed(x INTEGER); DROP TABLE _seed;"`);
};

const makeSetup = (dbPath: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA foreign_keys = ON;`;

      // Log doltlite version for debugging
      {
        let version = "unknown";
        try {
          const versionPath = require.resolve("better-sqlite3")
            .replace(/lib\/index\.js$/, "build/Release/.doltlite-version");
          const info = JSON.parse(require("fs").readFileSync(versionPath, "utf8"));
          version = `${info.commit} (lib: ${info.libBuilt}, addon: ${info.addonBuilt})`;
        } catch {}
        yield* Effect.logInfo(`doltlite version: ${version}`);
      }

      // Attach the FTS btree sidecar before migrations — migration 017/018
      // creates FTS5 tables in the fts.* schema.
      const ftsPath = ftsDbPath(dbPath);
      ensureFtsBtreeFile(ftsPath);
      yield* sql.unsafe(`ATTACH DATABASE '${ftsPath}' AS fts`);

      yield* runMigrations();
      // Initial dolt_commit after migrations — establishes HEAD so subsequent
      // dolt_commit calls have a parent to diff against.
      yield* sql`SELECT dolt_add('-A')`.pipe(
        Effect.flatMap(() => sql`SELECT dolt_commit('-m', 'schema: migrations')`),
        Effect.catch(() => Effect.void),
      );
    }),
  );

export const makeSqlitePersistenceLive = (dbPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

    return Layer.provideMerge(makeSetup(dbPath), makeRuntimeSqliteLayer({ filename: dbPath }));
  }).pipe(Layer.unwrap);

const memorySetup = Layer.effectDiscard(
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON;`;
    const tempDir = mkdtempSync(join(tmpdir(), "t3-fts-"));
    const ftsPath = join(tempDir, "fts.sqlite");
    ensureFtsBtreeFile(ftsPath);
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => rmSync(tempDir, { recursive: true, force: true })),
    );
    yield* sql.unsafe(`ATTACH DATABASE '${ftsPath}' AS fts`);
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
