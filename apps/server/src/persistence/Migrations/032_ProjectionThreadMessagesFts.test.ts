import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("032_ProjectionThreadMessagesFts", (it) => {
  it.effect("backfills and syncs thread message text", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 31 });

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
        VALUES (
          'message-1',
          'thread-1',
          'turn-1',
          'user',
          'alpha needle before migration',
          NULL,
          0,
          '2026-05-19T00:00:00.000Z',
          '2026-05-19T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 32 });

      const backfilled = yield* sql<{ readonly messageId: string }>`
        SELECT m.message_id AS "messageId"
        FROM messages_fts
        JOIN projection_thread_messages m ON m.rowid = messages_fts.rowid
        WHERE messages_fts MATCH 'needle'
      `;
      assert.deepStrictEqual(
        backfilled.map((row) => row.messageId),
        ["message-1"],
      );

      yield* sql`
        UPDATE projection_thread_messages
        SET text = 'beta haystack'
        WHERE message_id = 'message-1'
      `;

      const updated = yield* sql<{ readonly messageId: string }>`
        SELECT m.message_id AS "messageId"
        FROM messages_fts
        JOIN projection_thread_messages m ON m.rowid = messages_fts.rowid
        WHERE messages_fts MATCH 'haystack'
      `;
      assert.deepStrictEqual(
        updated.map((row) => row.messageId),
        ["message-1"],
      );

      yield* sql`
        DELETE FROM projection_thread_messages
        WHERE message_id = 'message-1'
      `;

      const deleted = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count"
        FROM messages_fts
        WHERE messages_fts MATCH 'haystack'
      `;
      assert.strictEqual(deleted[0]?.count, 0);
    }),
  );
});
