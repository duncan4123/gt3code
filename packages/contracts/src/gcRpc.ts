import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  GcConfigResult,
  GcFindThreadBindingError,
  GcFindThreadBindingInput,
  GcFindThreadBindingResult,
  GcGetConfigError,
  GcGetConfigInput,
  GcGetThreadContextError,
  GcGetThreadContextInput,
  GcRespondToPendingError,
  GcRespondToPendingInput,
  GcSessionActionResult,
  GcSetAgentMaxActiveSessionsError,
  GcSetAgentMaxActiveSessionsInput,
  GcSetAgentMinActiveSessionsError,
  GcSetAgentMinActiveSessionsInput,
  GcSetAgentSessionModeError,
  GcSetAgentSessionModeInput,
  GcSetAgentSuspendedError,
  GcSetAgentSuspendedInput,
  GcSetAgentWakeModeError,
  GcSetAgentWakeModeInput,
  GcSetCitySuspendedError,
  GcSetCitySuspendedInput,
  GcSetRigSuspendedError,
  GcSetRigSuspendedInput,
  GcStopSessionError,
  GcStopSessionInput,
  GcSubmitSessionError,
  GcSubmitSessionInput,
  GcSubmitSessionResult,
  GcThreadContextResult,
  GcWakeSessionError,
  GcWakeSessionInput,
} from "./gc.ts";

export const GC_WS_METHODS = {
  gcGetConfig: "gc.getConfig",
  gcFindThreadBinding: "gc.findThreadBinding",
  gcGetThreadContext: "gc.getThreadContext",
  gcSubmitSession: "gc.submitSession",
  gcStopSession: "gc.stopSession",
  gcWakeSession: "gc.wakeSession",
  gcRespondToPending: "gc.respondToPending",
  gcSetAgentSuspended: "gc.setAgentSuspended",
  gcSetAgentMaxActiveSessions: "gc.setAgentMaxActiveSessions",
  gcSetAgentMinActiveSessions: "gc.setAgentMinActiveSessions",
  gcSetAgentWakeMode: "gc.setAgentWakeMode",
  gcSetAgentSessionMode: "gc.setAgentSessionMode",
  gcSetCitySuspended: "gc.setCitySuspended",
  gcSetRigSuspended: "gc.setRigSuspended",
} as const;

export const WsGcGetConfigRpc = Rpc.make(GC_WS_METHODS.gcGetConfig, {
  payload: GcGetConfigInput,
  success: GcConfigResult,
  error: GcGetConfigError,
});

export const WsGcFindThreadBindingRpc = Rpc.make(GC_WS_METHODS.gcFindThreadBinding, {
  payload: GcFindThreadBindingInput,
  success: GcFindThreadBindingResult,
  error: GcFindThreadBindingError,
});

export const WsGcGetThreadContextRpc = Rpc.make(GC_WS_METHODS.gcGetThreadContext, {
  payload: GcGetThreadContextInput,
  success: GcThreadContextResult,
  error: GcGetThreadContextError,
});

export const WsGcSubmitSessionRpc = Rpc.make(GC_WS_METHODS.gcSubmitSession, {
  payload: GcSubmitSessionInput,
  success: GcSubmitSessionResult,
  error: GcSubmitSessionError,
});

export const WsGcStopSessionRpc = Rpc.make(GC_WS_METHODS.gcStopSession, {
  payload: GcStopSessionInput,
  success: GcSessionActionResult,
  error: GcStopSessionError,
});

export const WsGcWakeSessionRpc = Rpc.make(GC_WS_METHODS.gcWakeSession, {
  payload: GcWakeSessionInput,
  success: GcSessionActionResult,
  error: GcWakeSessionError,
});

export const WsGcRespondToPendingRpc = Rpc.make(GC_WS_METHODS.gcRespondToPending, {
  payload: GcRespondToPendingInput,
  success: GcSessionActionResult,
  error: GcRespondToPendingError,
});

export const WsGcSetAgentSuspendedRpc = Rpc.make(GC_WS_METHODS.gcSetAgentSuspended, {
  payload: GcSetAgentSuspendedInput,
  success: GcSessionActionResult,
  error: GcSetAgentSuspendedError,
});

export const WsGcSetAgentMaxActiveSessionsRpc = Rpc.make(
  GC_WS_METHODS.gcSetAgentMaxActiveSessions,
  {
    payload: GcSetAgentMaxActiveSessionsInput,
    success: GcSessionActionResult,
    error: GcSetAgentMaxActiveSessionsError,
  },
);

export const WsGcSetAgentMinActiveSessionsRpc = Rpc.make(
  GC_WS_METHODS.gcSetAgentMinActiveSessions,
  {
    payload: GcSetAgentMinActiveSessionsInput,
    success: GcSessionActionResult,
    error: GcSetAgentMinActiveSessionsError,
  },
);

export const WsGcSetAgentWakeModeRpc = Rpc.make(GC_WS_METHODS.gcSetAgentWakeMode, {
  payload: GcSetAgentWakeModeInput,
  success: GcSessionActionResult,
  error: GcSetAgentWakeModeError,
});

export const WsGcSetAgentSessionModeRpc = Rpc.make(GC_WS_METHODS.gcSetAgentSessionMode, {
  payload: GcSetAgentSessionModeInput,
  success: GcSessionActionResult,
  error: GcSetAgentSessionModeError,
});

export const WsGcSetCitySuspendedRpc = Rpc.make(GC_WS_METHODS.gcSetCitySuspended, {
  payload: GcSetCitySuspendedInput,
  success: GcSessionActionResult,
  error: GcSetCitySuspendedError,
});

export const WsGcSetRigSuspendedRpc = Rpc.make(GC_WS_METHODS.gcSetRigSuspended, {
  payload: GcSetRigSuspendedInput,
  success: GcSessionActionResult,
  error: GcSetRigSuspendedError,
});
