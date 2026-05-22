import {
  GcFindThreadBindingError,
  GcGetConfigError,
  GcGetThreadContextError,
  GcRespondToPendingError,
  GcSetControllerRunningError,
  GcSetAgentMaxActiveSessionsError,
  GcSetAgentMinActiveSessionsError,
  GcSetAgentSessionModeError,
  GcSetAgentSuspendedError,
  GcSetAgentWakeModeError,
  GcSetCitySuspendedError,
  GcSetRigSuspendedError,
  GcSetSupervisorRunningError,
  GcStopSessionError,
  GcSubmitSessionError,
  GcWakeSessionError,
  parseGcMeta,
  ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { observeRpcEffect } from "../observability/RpcInstrumentation.ts";
import type { GcApiClientShape } from "./Services/GcApiClient.ts";
import type { GcContextProviderShape } from "./Services/GcContextProvider.ts";

const messageFromUnknown = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const gcThreadSessionName = (
  projectionSnapshotQuery: ProjectionSnapshotQueryShape,
  threadId: ThreadId,
) =>
  projectionSnapshotQuery.getThreadShellById(threadId).pipe(
    Effect.flatMap((threadOption) =>
      Option.match(threadOption, {
        onNone: () => Effect.fail(new Error(`No active thread found for ${threadId}.`)),
        onSome: (thread) => {
          const sessionName = parseGcMeta(
            (thread as { readonly customMetadata?: Record<string, string> }).customMetadata,
          ).sessionName;
          return sessionName
            ? Effect.succeed(sessionName)
            : Effect.fail(new Error(`Thread ${threadId} is not bound to a GC session.`));
        },
      }),
    ),
  );

export const makeGcRpcHandlers = ({
  gcApiClient,
  gcContextProvider,
  projectionSnapshotQuery,
}: {
  readonly gcApiClient: GcApiClientShape;
  readonly gcContextProvider: GcContextProviderShape;
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
}) => ({
  [WS_METHODS.gcGetConfig]: (_input: {}) =>
    observeRpcEffect(
      WS_METHODS.gcGetConfig,
      gcApiClient.getConfig().pipe(
        Effect.flatMap((config) =>
          config
            ? Effect.succeed(config)
            : Effect.fail(new GcGetConfigError({ message: "Gas City config is unavailable." })),
        ),
        Effect.mapError((cause) =>
          Schema.is(GcGetConfigError)(cause)
            ? cause
            : new GcGetConfigError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcFindThreadBinding]: (input: { readonly sessionName: string }) =>
    observeRpcEffect(
      WS_METHODS.gcFindThreadBinding,
      (projectionSnapshotQuery.getActiveThreadBindingByGcSessionName
        ? projectionSnapshotQuery.getActiveThreadBindingByGcSessionName(input.sessionName)
        : Effect.succeed(Option.none())
      ).pipe(
        Effect.map((binding) =>
          Option.match(binding, {
            onNone: () => null,
            onSome: (value) => ({ ...value, sessionName: input.sessionName }),
          }),
        ),
        Effect.mapError(
          (cause) =>
            new GcFindThreadBindingError({
              message: `Failed to find GC thread binding: ${messageFromUnknown(cause)}`,
            }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcGetThreadContext]: (input: { readonly threadId: string }) =>
    observeRpcEffect(
      WS_METHODS.gcGetThreadContext,
      projectionSnapshotQuery.getThreadShellById(input.threadId as ThreadId).pipe(
        Effect.flatMap((threadOption) =>
          Option.match(threadOption, {
            onNone: () =>
              Effect.fail(
                new GcGetThreadContextError({
                  message: `No active thread found for ${input.threadId}.`,
                }),
              ),
            onSome: (thread) =>
              gcContextProvider.getThreadContext(
                (thread as { readonly customMetadata?: Record<string, string> }).customMetadata ??
                  {},
              ),
          }),
        ),
        Effect.mapError((cause) =>
          Schema.is(GcGetThreadContextError)(cause)
            ? cause
            : new GcGetThreadContextError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcSubmitSession]: (input: { readonly threadId: string; readonly message: string }) =>
    observeRpcEffect(
      WS_METHODS.gcSubmitSession,
      gcThreadSessionName(projectionSnapshotQuery, input.threadId as ThreadId).pipe(
        Effect.flatMap((sessionName) => gcApiClient.submitSession(sessionName, input.message)),
        Effect.mapError(
          (cause) => new GcSubmitSessionError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcStopSession]: (input: { readonly threadId: string }) =>
    observeRpcEffect(
      WS_METHODS.gcStopSession,
      gcThreadSessionName(projectionSnapshotQuery, input.threadId as ThreadId).pipe(
        Effect.flatMap((sessionName) => gcApiClient.stopSession(sessionName)),
        Effect.mapError((cause) => new GcStopSessionError({ message: messageFromUnknown(cause) })),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcWakeSession]: (input: { readonly sessionName: string }) =>
    observeRpcEffect(
      WS_METHODS.gcWakeSession,
      gcApiClient
        .wakeSession(input.sessionName)
        .pipe(
          Effect.mapError((cause) =>
            Schema.is(GcWakeSessionError)(cause)
              ? cause
              : new GcWakeSessionError({ message: messageFromUnknown(cause) }),
          ),
        ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcSetSupervisorRunning]: (input: {
    readonly running: boolean;
    readonly city?: string | undefined;
  }) =>
    observeRpcEffect(
      WS_METHODS.gcSetSupervisorRunning,
      gcApiClient
        .setSupervisorRunning(input.city, input.running)
        .pipe(
          Effect.mapError((cause) =>
            Schema.is(GcSetSupervisorRunningError)(cause)
              ? cause
              : new GcSetSupervisorRunningError({ message: messageFromUnknown(cause) }),
          ),
        ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcSetControllerRunning]: (input: {
    readonly running: boolean;
    readonly city?: string | undefined;
  }) =>
    observeRpcEffect(
      WS_METHODS.gcSetControllerRunning,
      gcApiClient
        .setControllerRunning(input.city, input.running)
        .pipe(
          Effect.mapError((cause) =>
            Schema.is(GcSetControllerRunningError)(cause)
              ? cause
              : new GcSetControllerRunningError({ message: messageFromUnknown(cause) }),
          ),
        ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcRespondToPending]: (input: {
    readonly threadId: string;
    readonly action: string;
    readonly requestId?: string | undefined;
    readonly text?: string | undefined;
    readonly metadata?: Record<string, string> | undefined;
  }) =>
    observeRpcEffect(
      WS_METHODS.gcRespondToPending,
      gcThreadSessionName(projectionSnapshotQuery, input.threadId as ThreadId).pipe(
        Effect.flatMap((sessionName) =>
          gcApiClient.respondToPending(sessionName, {
            action: input.action,
            ...(input.requestId ? { requestId: input.requestId } : {}),
            ...(input.text ? { text: input.text } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {}),
          }),
        ),
        Effect.mapError(
          (cause) => new GcRespondToPendingError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcSetAgentSuspended]: (input: {
    readonly agent: string;
    readonly suspended: boolean;
  }) =>
    observeRpcEffect(
      WS_METHODS.gcSetAgentSuspended,
      gcApiClient.setAgentSuspended(input.agent, input.suspended).pipe(
        Effect.as({
          id: input.agent,
          status: input.suspended ? "suspended" : "running",
        }),
        Effect.mapError((cause) =>
          Schema.is(GcSetAgentSuspendedError)(cause)
            ? cause
            : new GcSetAgentSuspendedError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcSetAgentMaxActiveSessions]: (input: {
    readonly agent: string;
    readonly maxActiveSessions: number;
  }) =>
    observeRpcEffect(
      WS_METHODS.gcSetAgentMaxActiveSessions,
      gcApiClient.setAgentMaxActiveSessions(input.agent, input.maxActiveSessions).pipe(
        Effect.as({ id: input.agent, status: "updated" }),
        Effect.mapError((cause) =>
          Schema.is(GcSetAgentMaxActiveSessionsError)(cause)
            ? cause
            : new GcSetAgentMaxActiveSessionsError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcSetAgentMinActiveSessions]: (input: {
    readonly agent: string;
    readonly minActiveSessions: number;
  }) =>
    observeRpcEffect(
      WS_METHODS.gcSetAgentMinActiveSessions,
      gcApiClient.setAgentMinActiveSessions(input.agent, input.minActiveSessions).pipe(
        Effect.as({ id: input.agent, status: "updated" }),
        Effect.mapError((cause) =>
          Schema.is(GcSetAgentMinActiveSessionsError)(cause)
            ? cause
            : new GcSetAgentMinActiveSessionsError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcSetAgentWakeMode]: (input: {
    readonly agent: string;
    readonly wakeMode: "resume" | "fresh";
  }) =>
    observeRpcEffect(
      WS_METHODS.gcSetAgentWakeMode,
      gcApiClient.setAgentWakeMode(input.agent, input.wakeMode).pipe(
        Effect.as({ id: input.agent, status: "updated" }),
        Effect.mapError((cause) =>
          Schema.is(GcSetAgentWakeModeError)(cause)
            ? cause
            : new GcSetAgentWakeModeError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcSetAgentSessionMode]: (input: {
    readonly agent: string;
    readonly mode: "always" | "on_demand";
  }) =>
    observeRpcEffect(
      WS_METHODS.gcSetAgentSessionMode,
      gcApiClient.setAgentSessionMode(input.agent, input.mode).pipe(
        Effect.as({ id: input.agent, status: "updated" }),
        Effect.mapError((cause) =>
          Schema.is(GcSetAgentSessionModeError)(cause)
            ? cause
            : new GcSetAgentSessionModeError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcSetCitySuspended]: (input: { readonly suspended: boolean }) =>
    observeRpcEffect(
      WS_METHODS.gcSetCitySuspended,
      gcApiClient.setCitySuspended(input.suspended).pipe(
        Effect.as({
          id: "city",
          status: input.suspended ? "suspended" : "running",
        }),
        Effect.mapError((cause) =>
          Schema.is(GcSetCitySuspendedError)(cause)
            ? cause
            : new GcSetCitySuspendedError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
  [WS_METHODS.gcSetRigSuspended]: (input: { readonly rig: string; readonly suspended: boolean }) =>
    observeRpcEffect(
      WS_METHODS.gcSetRigSuspended,
      gcApiClient.setRigSuspended(input.rig, input.suspended).pipe(
        Effect.as({
          id: input.rig,
          status: input.suspended ? "suspended" : "running",
        }),
        Effect.mapError((cause) =>
          Schema.is(GcSetRigSuspendedError)(cause)
            ? cause
            : new GcSetRigSuspendedError({ message: messageFromUnknown(cause) }),
        ),
      ),
      { "rpc.aggregate": "gc" },
    ),
});
