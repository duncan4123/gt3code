import {
  ChatAttachment,
  IsoDateTime,
  MessageId,
  OrchestrationMessageRole,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const FinalizedThreadMessage = Schema.Struct({
  messageId: MessageId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type FinalizedThreadMessage = typeof FinalizedThreadMessage.Type;

export const UpsertFinalizedThreadMessageInput = FinalizedThreadMessage;
export type UpsertFinalizedThreadMessageInput = typeof UpsertFinalizedThreadMessageInput.Type;

export const GetFinalizedThreadMessageInput = Schema.Struct({
  messageId: MessageId,
});
export type GetFinalizedThreadMessageInput = typeof GetFinalizedThreadMessageInput.Type;

export interface FinalizedThreadMessageRepositoryShape {
  readonly upsert: (
    message: UpsertFinalizedThreadMessageInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByMessageId: (
    input: GetFinalizedThreadMessageInput,
  ) => Effect.Effect<Option.Option<FinalizedThreadMessage>, ProjectionRepositoryError>;
}

export class FinalizedThreadMessageRepository extends Context.Service<
  FinalizedThreadMessageRepository,
  FinalizedThreadMessageRepositoryShape
>()("t3/persistence/Services/FinalizedThreadMessages/FinalizedThreadMessageRepository") {}
