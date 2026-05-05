import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("027_028_ProviderInstanceIdColumns", (it) => {
  it.effect("continues when provider_session_runtime was partially migrated", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`ATTACH DATABASE ':memory:' AS proj`;
      yield* runMigrations({ toMigrationInclusive: 32 });
      const preColumns = yield* sql<{ readonly name: string }>`
        PRAGMA proj.table_info(provider_session_runtime)
      `;
      if (!preColumns.some((column) => column.name === "provider_instance_id")) {
        yield* sql`
          ALTER TABLE proj.provider_session_runtime
          ADD COLUMN provider_instance_id TEXT
        `;
      }
      yield* sql`
        INSERT INTO proj.provider_session_runtime (
          thread_id,
          provider_name,
          adapter_key,
          runtime_mode,
          status,
          last_seen_at
        )
        VALUES (
          'thread-legacy-runtime',
          'opencode',
          'opencode',
          'full-access',
          'ready',
          '2026-01-01T00:00:00.000Z'
        )
      `;
      yield* runMigrations({ toMigrationInclusive: 35 });

      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id IN (33, 34)
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        {
          migration_id: 33,
          name: "ProviderSessionRuntimeInstanceId",
        },
        {
          migration_id: 34,
          name: "ProjectionThreadSessionInstanceId",
        },
      ]);

      const providerSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA proj.table_info(provider_session_runtime)
      `;
      assert.ok(providerSessionColumns.some((column) => column.name === "provider_instance_id"));

      const projectionThreadSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA proj.table_info(projection_thread_sessions)
      `;
      assert.ok(
        projectionThreadSessionColumns.some((column) => column.name === "provider_instance_id"),
      );

      const legacyRuntime = yield* sql<{ readonly providerInstanceId: string | null }>`
        SELECT provider_instance_id AS "providerInstanceId"
        FROM proj.provider_session_runtime
        WHERE thread_id = 'thread-legacy-runtime'
      `;
      assert.strictEqual(legacyRuntime[0]?.providerInstanceId, "opencode");
    }),
  );
});
