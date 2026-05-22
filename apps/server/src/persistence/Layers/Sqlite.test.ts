import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLive } from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeSqlitePersistenceLive, projDbPath, SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(SqlitePersistenceMemory);

layer("SqlitePersistence", (it) => {
  it.effect("keeps hot runtime tables in the attached projection sidecar", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const databases = yield* sql<{ readonly name: string }>`PRAGMA database_list`;
      assert.ok(databases.some((database) => database.name === "main"));
      assert.ok(databases.some((database) => database.name === "proj"));

      const mainHotTables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM main.sqlite_master
        WHERE type = 'table'
          AND name IN ('orchestration_events', 'projection_threads', 'messages_fts')
      `;
      assert.deepStrictEqual(mainHotTables, []);

      const sidecarHotTables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM proj.sqlite_master
        WHERE type IN ('table', 'virtual table')
          AND name IN ('orchestration_events', 'projection_threads', 'messages_fts')
        ORDER BY name
      `;
      assert.deepStrictEqual(
        sidecarHotTables.map((row) => row.name),
        ["messages_fts", "orchestration_events", "projection_threads"],
      );
    }),
  );

  it.effect("creates a DoltLite main database with a SQLite btree sidecar file", () =>
    Effect.gen(function* () {
      const tempDir = mkdtempSync(join(tmpdir(), "t3-sqlite-file-"));
      const dbPath = join(tempDir, "state.sqlite");
      const sidecarPath = projDbPath(dbPath);

      try {
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;

          const engine = yield* sql<{ readonly engine: string }>`
            SELECT doltlite_engine() AS "engine"
          `;
          assert.equal(engine[0]?.engine, "prolly");

          const databases = yield* sql<{ readonly name: string; readonly file: string }>`
            PRAGMA database_list
          `;
          assert.ok(databases.some((database) => database.name === "proj"));

          const eventTables = yield* sql<{ readonly name: string }>`
            SELECT name
            FROM proj.sqlite_master
            WHERE type = 'table'
              AND name = 'orchestration_events'
          `;
          assert.equal(eventTables.length, 1);
        }).pipe(
          Effect.provide(makeSqlitePersistenceLive(dbPath)),
          Effect.provide(NodeServicesLive),
        );

        assert.ok(existsSync(dbPath));
        assert.ok(existsSync(sidecarPath));
        assert.equal(
          readFileSync(sidecarPath, { encoding: null, flag: "r" })
            .subarray(0, 16)
            .toString("binary"),
          "SQLite format 3\0",
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );
});
