import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("034_ContentlessProjectionThreadMessagesFts", (it) => {
  it.effect("removes trigger-based FTS and backfills only finalized messages", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 32 });

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES
          (
            'final-message',
            'thread-1',
            'turn-1',
            'assistant',
            'final searchable',
            NULL,
            0,
            '2026-05-21T00:00:00.000Z',
            '2026-05-21T00:00:00.000Z'
          ),
          (
            'streaming-message',
            'thread-1',
            'turn-1',
            'assistant',
            'streaming partial',
            NULL,
            1,
            '2026-05-21T00:00:01.000Z',
            '2026-05-21T00:00:01.000Z'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 34 });

      const triggers = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count"
        FROM sqlite_master
        WHERE type = 'trigger'
          AND name IN ('messages_fts_insert', 'messages_fts_update', 'messages_fts_delete')
      `;
      assert.strictEqual(triggers[0]?.count, 0);

      const finalized = yield* sql<{ readonly rowid: number }>`
        SELECT rowid
        FROM messages_fts
        WHERE messages_fts MATCH 'searchable'
      `;
      assert.strictEqual(finalized.length, 1);

      const streaming = yield* sql<{ readonly rowid: number }>`
        SELECT rowid
        FROM messages_fts
        WHERE messages_fts MATCH 'partial'
      `;
      assert.strictEqual(streaming.length, 0);
    }),
  );
});
