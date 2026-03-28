import { Effect, Layer, FileSystem, Path } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { ServerConfig } from "../../config.ts";
import { layer as doltliteLayer } from "../DoltliteClient.ts";

const makeRuntimeSqliteLayer = (config: {
  readonly filename: string;
}): Layer.Layer<SqlClient.SqlClient> => doltliteLayer({ ...config, wal: false });

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON;`;
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

    return Layer.provideMerge(setup, makeRuntimeSqliteLayer({ filename: dbPath }));
  }).pipe(Layer.unwrap);

export const SqlitePersistenceMemory = Layer.provideMerge(
  setup,
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);
