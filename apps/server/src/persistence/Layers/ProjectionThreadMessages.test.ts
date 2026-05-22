import { MessageId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionThreadMessageRepository } from "../Services/ProjectionThreadMessages.ts";
import { ProjectionThreadMessageRepositoryLive } from "./ProjectionThreadMessages.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadMessageRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadMessageRepository", (it) => {
  it.effect("preserves existing attachments when upsert omits attachments", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-preserve-attachments");
      const messageId = MessageId.make("message-preserve-attachments");
      const createdAt = "2026-02-28T19:00:00.000Z";
      const updatedAt = "2026-02-28T19:00:01.000Z";
      const persistedAttachments = [
        {
          type: "image" as const,
          id: "thread-preserve-attachments-att-1",
          name: "example.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      ];

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "initial",
        attachments: persistedAttachments,
        isStreaming: false,
        createdAt,
        updatedAt,
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "updated",
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:00:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "updated");
      assert.deepEqual(rows[0]?.attachments, persistedAttachments);

      const rowById = yield* repository.getByMessageId({ messageId });
      assert.equal(rowById._tag, "Some");
      if (rowById._tag === "Some") {
        assert.equal(rowById.value.text, "updated");
        assert.deepEqual(rowById.value.attachments, persistedAttachments);
      }
    }),
  );

  it.effect("allows explicit attachment clearing with an empty array", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-clear-attachments");
      const messageId = MessageId.make("message-clear-attachments");
      const createdAt = "2026-02-28T19:10:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "with attachment",
        attachments: [
          {
            type: "image",
            id: "thread-clear-attachments-att-1",
            name: "example.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ],
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:10:01.000Z",
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "cleared",
        attachments: [],
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:10:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "cleared");
      assert.deepEqual(rows[0]?.attachments, []);
    }),
  );

  it.effect("indexes finalized messages but not streaming updates", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-fts-streaming");
      const messageId = MessageId.make("message-fts-streaming");
      const createdAt = "2026-05-21T00:00:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "partial needle",
        isStreaming: true,
        createdAt,
        updatedAt: "2026-05-21T00:00:01.000Z",
      });

      const streamingHits = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count"
        FROM messages_fts
        WHERE messages_fts MATCH 'needle'
      `;
      assert.strictEqual(streamingHits[0]?.count, 0);

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "final needle",
        isStreaming: false,
        createdAt,
        updatedAt: "2026-05-21T00:00:02.000Z",
      });

      const finalizedHits = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count"
        FROM messages_fts
        WHERE messages_fts MATCH 'needle'
      `;
      assert.strictEqual(finalizedHits[0]?.count, 1);
    }),
  );

  it.effect("removes FTS rows before deleting thread messages", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-fts-delete");
      const messageId = MessageId.make("message-fts-delete");
      const createdAt = "2026-05-21T00:10:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "delete searchable",
        isStreaming: false,
        createdAt,
        updatedAt: createdAt,
      });

      yield* repository.deleteByThreadId({ threadId });

      const hits = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count"
        FROM messages_fts
        WHERE messages_fts MATCH 'searchable'
      `;
      assert.strictEqual(hits[0]?.count, 0);
    }),
  );
});
