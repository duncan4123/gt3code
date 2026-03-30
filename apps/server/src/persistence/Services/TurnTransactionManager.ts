import { Effect, ServiceMap } from "effect";

import type { ThreadId, TurnId } from "@t3tools/contracts";
import type { SqlError } from "effect/unstable/sql/SqlError";

export interface TurnTransactionScope {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly startedAt: string;
}

export interface TurnTransactionManagerShape {
  readonly beginTurnTransaction: (scope: TurnTransactionScope) => Effect.Effect<void, SqlError>;
  readonly commitTurnTransaction: (
    scope: Pick<TurnTransactionScope, "threadId" | "turnId">,
  ) => Effect.Effect<void, SqlError>;
  readonly rollbackTurnTransaction: (
    scope: Pick<TurnTransactionScope, "threadId" | "turnId">,
    reason?: string,
  ) => Effect.Effect<void, SqlError>;
  readonly abortActiveForThread: (
    threadId: ThreadId,
    reason: string,
  ) => Effect.Effect<void, SqlError>;
  readonly runOrDeferPostCommit: (effect: Effect.Effect<void>) => Effect.Effect<void>;
  readonly withCommandScope: <R, E>(effect: Effect.Effect<R, E>) => Effect.Effect<R, E | SqlError>;
  readonly getActiveScope: () => Effect.Effect<TurnTransactionScope | undefined, never>;
}

export class TurnTransactionManager extends ServiceMap.Service<
  TurnTransactionManager,
  TurnTransactionManagerShape
>()("t3/persistence/Services/TurnTransactionManager") {}
