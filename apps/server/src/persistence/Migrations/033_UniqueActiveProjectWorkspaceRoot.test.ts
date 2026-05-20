import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("033_UniqueActiveProjectWorkspaceRoot", (it) => {
  it.effect("rejects duplicate active project workspace roots", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 33 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-a',
          'Project A',
          '/tmp/rig',
          NULL,
          '[]',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL
        )
      `;

      yield* Effect.flip(
        sql`
          INSERT INTO projection_projects (
            project_id,
            title,
            workspace_root,
            default_model_selection_json,
            scripts_json,
            created_at,
            updated_at,
            deleted_at
          )
          VALUES (
            'project-b',
            'Project B',
            '/tmp/rig',
            NULL,
            '[]',
            '2026-01-02T00:00:00.000Z',
            '2026-01-02T00:00:00.000Z',
            NULL
          )
        `,
      );

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-deleted',
          'Project Deleted',
          '/tmp/rig',
          NULL,
          '[]',
          '2026-01-03T00:00:00.000Z',
          '2026-01-03T00:00:00.000Z',
          '2026-01-04T00:00:00.000Z'
        )
      `;

      const indexes = yield* sql<{
        readonly name: string;
        readonly unique: number;
        readonly partial: number;
      }>`
        PRAGMA index_list(projection_projects)
      `;
      assert.ok(
        indexes.some(
          (index) =>
            index.name === "idx_projection_projects_active_workspace_root_unique" &&
            index.unique === 1 &&
            index.partial === 1,
        ),
      );
    }),
  );
});
