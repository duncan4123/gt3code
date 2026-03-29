import { MessageId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceSqlError } from "../Errors.ts";
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
      const threadId = ThreadId.makeUnsafe("thread-preserve-attachments");
      const messageId = MessageId.makeUnsafe("message-preserve-attachments");
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
    }),
  );

  it.effect("allows explicit attachment clearing with an empty array", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.makeUnsafe("thread-clear-attachments");
      const messageId = MessageId.makeUnsafe("message-clear-attachments");
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

  it.effect("searches through the attached FTS index and deduplicates by thread", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.makeUnsafe("thread-search-fts");
      const messageA = MessageId.makeUnsafe("message-search-fts-a");
      const messageB = MessageId.makeUnsafe("message-search-fts-b");
      const createdAt = "2026-02-28T19:20:00.000Z";

      yield* repository.upsert({
        messageId: messageA,
        threadId,
        turnId: null,
        role: "user",
        text: "alpha beta first",
        isStreaming: false,
        createdAt,
        updatedAt: createdAt,
      });
      yield* repository.upsert({
        messageId: messageB,
        threadId,
        turnId: null,
        role: "assistant",
        text: "alpha beta second",
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:20:01.000Z",
      });

      yield* sql.unsafe(
        `INSERT INTO fts.messages_fts(rowid, text)
         SELECT rowid, text FROM projection_thread_messages WHERE thread_id = ?`,
        [threadId],
      );

      const rows = yield* repository.searchByText({ query: "alpha", limit: 5 });
      assert.deepEqual(rows, [{ threadId, snippet: "alpha beta first" }]);
    }),
  );

  it.effect("surfaces invalid FTS queries instead of silently returning empty results", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const error = yield* repository.searchByText({ query: '"', limit: 5 }).pipe(Effect.flip);
      assert.instanceOf(error, PersistenceSqlError);
    }),
  );
});
