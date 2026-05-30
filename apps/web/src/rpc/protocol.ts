import { WsRpcGroup } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as RpcSchema from "effect/unstable/rpc/RpcSchema";
import * as Socket from "effect/unstable/socket/Socket";

import {
  acknowledgeRpcRequest,
  clearAllTrackedRpcRequests,
  trackRpcRequestSent,
} from "./requestLatencyState";
import {
  getWsReconnectDelayMsForRetry,
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionErrored,
  recordWsConnectionOpened,
  type WsConnectionMetadata,
  WS_RECONNECT_MAX_RETRIES,
} from "./wsConnectionState";

export interface WsProtocolCloseContext {
  readonly intentional: boolean;
}

export interface WsProtocolLifecycleHandlers {
  readonly getConnectionLabel?: () => string | null;
  readonly getVersionMismatchHint?: () => string | null;
  readonly isCloseIntentional?: () => boolean;
  readonly isActive?: () => boolean;
  readonly onAttempt?: (socketUrl: string) => void;
  readonly onOpen?: () => void;
  readonly onHeartbeatPing?: () => void;
  readonly onHeartbeatPong?: () => void;
  readonly onHeartbeatTimeout?: () => void;
  readonly onRequestStart?: (info: {
    readonly id: string;
    readonly tag: string;
    readonly stream: boolean;
  }) => void;
  readonly onRequestChunk?: (info: {
    readonly id: string;
    readonly tag: string;
    readonly chunkCount: number;
  }) => void;
  readonly onRequestExit?: (info: {
    readonly id: string;
    readonly tag: string;
    readonly stream: boolean;
  }) => void;
  readonly onRequestInterrupt?: (info: { readonly id: string; readonly tag?: string }) => void;
  readonly onError?: (message: string) => void;
  readonly onClose?: (
    details: { readonly code: number; readonly reason: string },
    context: WsProtocolCloseContext,
  ) => void;
}

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup);
type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;
export type WsRpcProtocolSocketUrlProvider = string | (() => Promise<string>);

const wsRpcStreamRequestTags: ReadonlySet<string> = new Set(
  Array.from(WsRpcGroup.requests.entries())
    .filter(([, request]) => Option.isSome(RpcSchema.getStreamSchemas(request.successSchema)))
    .map(([tag]) => tag),
);

interface TrackedRpcRequest {
  readonly tag: string;
  readonly stream: boolean;
  readonly chunkCount: number;
}

function asWireMessage(value: unknown): {
  readonly _tag: string;
  readonly id?: unknown;
  readonly requestId?: unknown;
  readonly tag?: unknown;
} | null {
  if (typeof value !== "object" || value === null || !("_tag" in value)) {
    return null;
  }
  return value as {
    readonly _tag: string;
    readonly id?: unknown;
    readonly requestId?: unknown;
    readonly tag?: unknown;
  };
}

function formatSocketErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

function resolveWsRpcSocketUrl(rawUrl: string): string {
  const resolved = new URL(rawUrl);
  if (resolved.protocol !== "ws:" && resolved.protocol !== "wss:") {
    throw new Error(`Unsupported websocket transport URL protocol: ${resolved.protocol}`);
  }

  resolved.pathname = "/ws";
  return resolved.toString();
}

function resolveConnectionMetadata(handlers?: WsProtocolLifecycleHandlers): WsConnectionMetadata {
  return {
    connectionLabel: handlers?.getConnectionLabel?.() ?? null,
    versionMismatchHint: handlers?.getVersionMismatchHint?.() ?? null,
  };
}

type ComposedWsProtocolLifecycleHandlers = Required<
  Pick<WsProtocolLifecycleHandlers, "isActive" | "onAttempt" | "onOpen" | "onError" | "onClose">
>;

function defaultLifecycleHandlers(
  handlers?: WsProtocolLifecycleHandlers,
): ComposedWsProtocolLifecycleHandlers {
  return {
    isActive: () => true,
    onAttempt: (socketUrl) => {
      recordWsConnectionAttempt(socketUrl, resolveConnectionMetadata(handlers));
    },
    onOpen: () => {
      recordWsConnectionOpened(resolveConnectionMetadata(handlers));
    },
    onError: (message) => {
      clearAllTrackedRpcRequests();
      recordWsConnectionErrored(message, resolveConnectionMetadata(handlers));
    },
    onClose: (details, context) => {
      clearAllTrackedRpcRequests();
      if (context.intentional) {
        return;
      }
      recordWsConnectionClosed(details, resolveConnectionMetadata(handlers));
    },
  };
}

function composeLifecycleHandlers(
  handlers?: WsProtocolLifecycleHandlers,
): ComposedWsProtocolLifecycleHandlers {
  const defaults = defaultLifecycleHandlers(handlers);
  const isActive = handlers?.isActive ?? defaults.isActive;

  return {
    isActive,
    onAttempt: (socketUrl) => {
      if (!isActive()) {
        return;
      }
      defaults.onAttempt(socketUrl);
      handlers?.onAttempt?.(socketUrl);
    },
    onOpen: () => {
      if (!isActive()) {
        return;
      }
      defaults.onOpen();
      handlers?.onOpen?.();
    },
    onError: (message) => {
      if (!isActive()) {
        return;
      }
      defaults.onError(message);
      handlers?.onError?.(message);
    },
    onClose: (details, context) => {
      if (!isActive()) {
        return;
      }
      defaults.onClose(details, context);
      handlers?.onClose?.(details, context);
    },
  };
}

export function createWsRpcProtocolLayer(
  url: WsRpcProtocolSocketUrlProvider,
  handlers?: WsProtocolLifecycleHandlers,
) {
  const lifecycle = composeLifecycleHandlers(handlers);
  const resolvedUrl =
    typeof url === "function"
      ? Effect.promise(() => url()).pipe(
          Effect.map((rawUrl) => resolveWsRpcSocketUrl(rawUrl)),
          Effect.tapError((error) =>
            Effect.sync(() => {
              lifecycle.onError(formatSocketErrorMessage(error));
            }),
          ),
          Effect.orDie,
        )
      : resolveWsRpcSocketUrl(url);

  const trackingWebSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) => {
      lifecycle.onAttempt(socketUrl);
      const socket = new globalThis.WebSocket(socketUrl, protocols);

      socket.addEventListener(
        "open",
        () => {
          lifecycle.onOpen();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          lifecycle.onError("Unable to connect to the T3 server WebSocket.");
        },
        { once: true },
      );
      socket.addEventListener(
        "close",
        (event) => {
          lifecycle.onClose(
            {
              code: event.code,
              reason: event.reason,
            },
            {
              intentional: handlers?.isCloseIntentional?.() ?? false,
            },
          );
        },
        { once: true },
      );

      return socket;
    },
  );
  const socketLayer = Socket.layerWebSocket(resolvedUrl).pipe(
    Layer.provide(trackingWebSocketConstructorLayer),
  );
  const retryPolicy = Schedule.addDelay(Schedule.recurs(WS_RECONNECT_MAX_RETRIES), (retryCount) =>
    Effect.succeed(Duration.millis(getWsReconnectDelayMsForRetry(retryCount) ?? 0)),
  );
  const trackedRequests = new Map<string, TrackedRpcRequest>();
  const protocolLayer = Layer.effect(
    RpcClient.Protocol,
    Effect.map(
      RpcClient.makeProtocolSocket({
        retryPolicy,
        retryTransientErrors: true,
      }),
      (protocol) => ({
        ...protocol,
        send: (...args: Parameters<typeof protocol.send>) => {
          const [, request] = args;
          const message = asWireMessage(request);
          if (message?._tag === "Request") {
            const id = String(message.id);
            const tag = typeof message.tag === "string" ? message.tag : "";
            const stream = wsRpcStreamRequestTags.has(tag);
            trackedRequests.set(id, { tag, stream, chunkCount: 0 });
            if (lifecycle.isActive()) {
              handlers?.onRequestStart?.({ id, tag, stream });
              trackRpcRequestSent(id, tag);
            }
          } else if (message?._tag === "Interrupt") {
            const id = String(message.requestId);
            const tracked = trackedRequests.get(id);
            trackedRequests.delete(id);
            if (lifecycle.isActive()) {
              handlers?.onRequestInterrupt?.({
                id,
                ...(tracked?.tag === undefined ? {} : { tag: tracked.tag }),
              });
              acknowledgeRpcRequest(id);
            }
          }
          return protocol.send(...args);
        },
        run: (clientId, writeResponse) =>
          protocol.run(clientId, (response) => {
            const message = asWireMessage(response);
            if (message?._tag === "Chunk") {
              const id = String(message.requestId);
              const tracked = trackedRequests.get(id);
              if (tracked && lifecycle.isActive()) {
                const chunkCount = tracked.chunkCount + 1;
                trackedRequests.set(id, { ...tracked, chunkCount });
                handlers?.onRequestChunk?.({
                  id,
                  tag: tracked.tag,
                  chunkCount,
                });
                acknowledgeRpcRequest(id);
              }
            } else if (message?._tag === "Exit") {
              const id = String(message.requestId);
              const tracked = trackedRequests.get(id);
              trackedRequests.delete(id);
              if (tracked && lifecycle.isActive()) {
                handlers?.onRequestExit?.({
                  id,
                  tag: tracked.tag,
                  stream: tracked.stream,
                });
                acknowledgeRpcRequest(id);
              }
            }
            if (response._tag === "ClientProtocolError" || response._tag === "Defect") {
              clearAllTrackedRpcRequests();
            }
            return writeResponse(response);
          }),
      }),
    ),
  );
  const connectionHooksLayer = Layer.succeed(
    RpcClient.ConnectionHooks,
    RpcClient.ConnectionHooks.of({
      onConnect: Effect.void,
      onDisconnect: Effect.void,
      onPing: Effect.sync(() => {
        if (lifecycle.isActive()) {
          handlers?.onHeartbeatPing?.();
        }
      }),
      onPong: Effect.sync(() => {
        if (lifecycle.isActive()) {
          handlers?.onHeartbeatPong?.();
        }
      }),
      onPingTimeout: Effect.sync(() => {
        if (lifecycle.isActive()) {
          clearAllTrackedRpcRequests();
          recordWsConnectionErrored(
            "WebSocket heartbeat timed out.",
            resolveConnectionMetadata(handlers),
          );
          handlers?.onHeartbeatTimeout?.();
        }
      }),
    }),
  );

  return Layer.mergeAll(
    protocolLayer.pipe(
      Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson, connectionHooksLayer)),
    ),
    connectionHooksLayer,
  );
}
