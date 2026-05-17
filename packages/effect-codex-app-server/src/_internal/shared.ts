import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import * as CodexError from "../errors.ts";

const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

export const JsonRpcId = Schema.Union([Schema.Number, Schema.String]);

export const JsonRpcError = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
});

export const JsonRpcResponseEnvelope = Schema.Struct({
  id: JsonRpcId,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(JsonRpcError),
});

const normalizeThreadPayload = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null || !("thread" in raw)) {
    return raw;
  }

  const payload = raw as { readonly thread?: unknown };
  if (typeof payload.thread !== "object" || payload.thread === null) {
    return raw;
  }

  const thread = payload.thread as { readonly id?: unknown; readonly sessionId?: unknown };
  if (thread.sessionId !== undefined || typeof thread.id !== "string") {
    return raw;
  }

  return {
    ...payload,
    thread: {
      ...thread,
      sessionId: thread.id,
    },
  };
};

export const decodeOptionalPayload = <A, I>(
  method: string,
  schema: Schema.Codec<A, I> | undefined,
  raw: unknown,
): Effect.Effect<A, CodexError.CodexAppServerRequestError> => {
  if (!schema) {
    if (raw === undefined) {
      return Effect.sync(() => undefined as A);
    }
    return Effect.fail(
      CodexError.CodexAppServerRequestError.invalidParams(`${method} does not accept params`, raw),
    );
  }

  return Schema.decodeUnknownEffect(schema)(normalizeThreadPayload(raw)).pipe(
    Effect.mapError((error) =>
      CodexError.CodexAppServerRequestError.invalidParams(
        `Invalid ${method} payload: ${formatSchemaIssue(error.issue)}`,
        { issue: error.issue },
      ),
    ),
  );
};

export const encodeOptionalPayload = <A, I>(
  method: string,
  schema: Schema.Codec<A, I> | undefined,
  payload: A,
): Effect.Effect<I | undefined, CodexError.CodexAppServerRequestError> => {
  if (!schema) {
    if (payload === undefined) {
      return Effect.sync(() => undefined);
    }
    return Effect.fail(
      CodexError.CodexAppServerRequestError.invalidParams(
        `${method} does not accept params`,
        payload,
      ),
    );
  }

  return Schema.encodeEffect(schema)(payload).pipe(
    Effect.mapError((error) =>
      CodexError.CodexAppServerRequestError.invalidParams(
        `Invalid ${method} payload: ${formatSchemaIssue(error.issue)}`,
        { issue: error.issue },
      ),
    ),
  );
};

export const decodeNotificationPayload = <A, I>(
  method: string,
  schema: Schema.Codec<A, I> | undefined,
  raw: unknown,
): Effect.Effect<A, CodexError.CodexAppServerProtocolParseError> =>
  decodeOptionalPayload(method, schema, raw).pipe(
    Effect.mapError(
      (error) =>
        new CodexError.CodexAppServerProtocolParseError({
          detail: error.message,
          cause: error,
        }),
    ),
  );

export const runHandler = Effect.fnUntraced(function* <A, B>(
  handler: ((payload: A) => Effect.Effect<B, CodexError.CodexAppServerError>) | undefined,
  payload: A,
  method: string,
) {
  if (!handler) {
    return yield* CodexError.CodexAppServerRequestError.methodNotFound(method);
  }

  return yield* handler(payload).pipe(
    Effect.mapError((error) => CodexError.normalizeToRequestError(error)),
  );
});
