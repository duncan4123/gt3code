import { Cause, Effect, Layer, Option, Ref } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import type { ThreadId } from "@t3tools/contracts";

import {
  TurnTransactionManager,
  type TurnTransactionManagerShape,
  type TurnTransactionScope,
} from "../Services/TurnTransactionManager.ts";

interface TurnTransactionState {
  readonly active: Option.Option<TurnTransactionScope>;
  readonly savepointCounter: number;
  readonly postCommitEffects: ReadonlyArray<Effect.Effect<void>>;
}

const initialState: TurnTransactionState = {
  active: Option.none(),
  savepointCounter: 0,
  postCommitEffects: [],
};

function isNoActiveTransactionCause(cause: Cause.Cause<unknown>): boolean {
  const message = Cause.pretty(cause).toLowerCase();
  return (
    message.includes("no transaction is active") ||
    message.includes("cannot commit") ||
    message.includes("cannot rollback")
  );
}

const makeTurnTransactionManager = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const stateRef = yield* Ref.make<TurnTransactionState>(initialState);

  const getActiveScope: TurnTransactionManagerShape["getActiveScope"] = () =>
    Ref.get(stateRef).pipe(Effect.map((state) => Option.getOrUndefined(state.active)));

  const clearState = () => Ref.set(stateRef, initialState);

  const forceRollback = (reason: string) =>
    Effect.gen(function* () {
      const active = yield* getActiveScope();
      if (!active) {
        return;
      }
      yield* sql.unsafe("ROLLBACK").pipe(Effect.catch(() => Effect.void));
      yield* clearState();
      yield* Effect.logWarning("turn transaction rolled back", {
        threadId: active.threadId,
        turnId: active.turnId,
        reason,
      });
    });

  const beginTurnTransaction: TurnTransactionManagerShape["beginTurnTransaction"] = (scope) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(stateRef);
      if (Option.isSome(current.active)) {
        const existing = current.active.value;
        if (existing.turnId === scope.turnId && existing.threadId === scope.threadId) {
          return;
        }
        yield* Effect.logWarning("ending overlapping turn transaction", {
          activeThreadId: existing.threadId,
          activeTurnId: existing.turnId,
          requestedThreadId: scope.threadId,
          requestedTurnId: scope.turnId,
        });
        yield* forceRollback("overlapping turn started");
      }
      yield* sql.unsafe("BEGIN IMMEDIATE TRANSACTION");
      yield* Ref.set(stateRef, {
        active: Option.some(scope),
        savepointCounter: 0,
        postCommitEffects: [],
      });
      yield* Effect.logDebug("turn transaction started", {
        threadId: scope.threadId,
        turnId: scope.turnId,
      });
    });

  const commitTurnTransaction: TurnTransactionManagerShape["commitTurnTransaction"] = (scope) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(stateRef);
      if (Option.isNone(current.active)) {
        return;
      }
      const active = current.active.value;
      if (active.threadId !== scope.threadId || active.turnId !== scope.turnId) {
        return;
      }

      const postCommitEffects = current.postCommitEffects;
      yield* sql.unsafe("COMMIT");
      yield* clearState();
      yield* Effect.logDebug("turn transaction committed", scope);
      yield* Effect.forEach(postCommitEffects, (effect) => effect, { concurrency: 1 }).pipe(
        Effect.asVoid,
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          if (isNoActiveTransactionCause(cause)) {
            const current = yield* Ref.get(stateRef);
            if (
              Option.isSome(current.active) &&
              current.active.value.threadId === scope.threadId &&
              current.active.value.turnId === scope.turnId
            ) {
              const postCommitEffects = current.postCommitEffects;
              yield* clearState();
              yield* Effect.logWarning("turn transaction already closed before commit", scope);
              yield* Effect.forEach(postCommitEffects, (effect) => effect, {
                concurrency: 1,
              }).pipe(Effect.asVoid);
            }
            return;
          }
          yield* Effect.logWarning("turn transaction commit failed", {
            ...scope,
            cause: Cause.pretty(cause),
          });
          yield* forceRollback("commit failed");
          return yield* Effect.failCause(cause);
        }),
      ),
    );

  const rollbackTurnTransaction: TurnTransactionManagerShape["rollbackTurnTransaction"] = (
    scope,
    reason?,
  ) =>
    Effect.gen(function* () {
      const active = yield* getActiveScope();
      if (!active || active.threadId !== scope.threadId || active.turnId !== scope.turnId) {
        return;
      }
      yield* forceRollback(reason ?? "rollback requested");
    }).pipe(
      Effect.catchCause((cause) => {
        if (isNoActiveTransactionCause(cause)) {
          return clearState().pipe(
            Effect.flatMap(() =>
              Effect.logWarning("turn transaction already closed before rollback", {
                ...scope,
                reason: reason ?? "rollback requested",
              }),
            ),
          );
        }
        return Effect.failCause(cause);
      }),
    );

  const abortActiveForThread: TurnTransactionManagerShape["abortActiveForThread"] = (
    threadId: ThreadId,
    reason: string,
  ) =>
    Effect.gen(function* () {
      const active = yield* getActiveScope();
      if (!active || active.threadId !== threadId) {
        return;
      }
      yield* forceRollback(reason);
    });

  const runOrDeferPostCommit: TurnTransactionManagerShape["runOrDeferPostCommit"] = (effect) =>
    Ref.modify(stateRef, (current) => {
      if (Option.isNone(current.active)) {
        return [false, current] as const;
      }
      return [
        true,
        {
          ...current,
          postCommitEffects: [...current.postCommitEffects, effect],
        },
      ] as const;
    }).pipe(Effect.flatMap((deferred) => (deferred ? Effect.void : effect)));

  function withCommandScope<R, E>(effect: Effect.Effect<R, E>): Effect.Effect<R, E | SqlError> {
    return Effect.flatMap(Ref.get(stateRef), (current) => {
      if (Option.isNone(current.active)) {
        return sql.withTransaction(effect) as Effect.Effect<R, E | SqlError>;
      }
      return effect.pipe(
        Effect.catchCause((cause) =>
          forceRollback("command failed inside active turn transaction").pipe(
            Effect.flatMap(() => Effect.failCause(cause)),
          ),
        ),
      ) as Effect.Effect<R, E | SqlError>;
    });
  }

  return {
    beginTurnTransaction,
    commitTurnTransaction,
    rollbackTurnTransaction,
    abortActiveForThread,
    runOrDeferPostCommit,
    withCommandScope,
    getActiveScope,
  } satisfies TurnTransactionManagerShape;
});

export const TurnTransactionManagerLive = Layer.effect(
  TurnTransactionManager,
  makeTurnTransactionManager,
);
