import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import { ChatAttachment } from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  FinalizedThreadMessage,
  FinalizedThreadMessageRepository,
  GetFinalizedThreadMessageInput,
  type FinalizedThreadMessageRepositoryShape,
} from "../Services/FinalizedThreadMessages.ts";

const FinalizedThreadMessageDbRowSchema = FinalizedThreadMessage.mapFields(
  Struct.assign({
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  }),
);

function toFinalizedThreadMessage(
  row: Schema.Schema.Type<typeof FinalizedThreadMessageDbRowSchema>,
): FinalizedThreadMessage {
  return {
    messageId: row.messageId,
    threadId: row.threadId,
    turnId: row.turnId,
    role: row.role,
    text: row.text,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.attachments !== null ? { attachments: row.attachments } : {}),
  };
}

const makeFinalizedThreadMessageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertFinalizedThreadMessageRow = SqlSchema.void({
    Request: FinalizedThreadMessage,
    execute: (row) =>
      sql`
        INSERT INTO finalized_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          created_at,
          updated_at
        )
        VALUES (
          ${row.messageId},
          ${row.threadId},
          ${row.turnId},
          ${row.role},
          ${row.text},
          ${row.attachments !== undefined ? JSON.stringify(row.attachments) : null},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          role = excluded.role,
          text = excluded.text,
          attachments_json = excluded.attachments_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getFinalizedThreadMessageRow = SqlSchema.findOneOption({
    Request: GetFinalizedThreadMessageInput,
    Result: FinalizedThreadMessageDbRowSchema,
    execute: ({ messageId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM finalized_thread_messages
        WHERE message_id = ${messageId}
      `,
  });

  const upsert: FinalizedThreadMessageRepositoryShape["upsert"] = (row) =>
    sql.withTransaction(upsertFinalizedThreadMessageRow(row)).pipe(
      Effect.mapError(toPersistenceSqlError("FinalizedThreadMessageRepository.upsert:query")),
    );

  const getByMessageId: FinalizedThreadMessageRepositoryShape["getByMessageId"] = (input) =>
    getFinalizedThreadMessageRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("FinalizedThreadMessageRepository.getByMessageId:query"),
      ),
      Effect.map(Option.map(toFinalizedThreadMessage)),
    );

  return {
    upsert,
    getByMessageId,
  } satisfies FinalizedThreadMessageRepositoryShape;
});

export const FinalizedThreadMessageRepositoryLive = Layer.effect(
  FinalizedThreadMessageRepository,
  makeFinalizedThreadMessageRepository,
);
