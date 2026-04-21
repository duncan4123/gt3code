import type { GcFindThreadBindingResult, OrchestrationLatestTurn } from "@t3tools/contracts";

import { isSessionActivelyRunning } from "../../session-logic";

export type GcNamedSessionMode = "always" | "on_demand";

export type GcAgentActionState =
  | {
      kind: "resume";
    }
  | {
      kind: "suspend";
    }
  | {
      kind: "pool-size";
      maxActiveSessions: number;
    }
  | {
      kind: "session-mode";
      targetMode: GcNamedSessionMode;
    };

type AgentThreadState = {
  latestTurn: OrchestrationLatestTurn | null;
  session: Parameters<typeof isSessionActivelyRunning>[0];
};

export type GcAgentRuntimeTone = "info" | "muted" | "success" | "warning";

export interface GcAgentRuntimeState {
  label: string;
  tone: GcAgentRuntimeTone;
}

export function gcSessionNameForQualifiedAgent(agent: string): string {
  return agent.replaceAll("/", "--").replaceAll(".", "__");
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function waitForGcAgentBinding(input: {
  agent: string;
  findThreadBinding: (sessionName: string) => Promise<GcFindThreadBindingResult>;
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<
  | {
      status: "started";
      sessionName: string;
      binding: NonNullable<GcFindThreadBindingResult>;
    }
  | {
      status: "timeout";
      sessionName: string;
    }
> {
  const intervalMs = input.intervalMs ?? 1_500;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const sessionName = gcSessionNameForQualifiedAgent(input.agent);
  const startedAtMs = Date.now();

  while (Date.now() - startedAtMs <= timeoutMs) {
    if (input.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const binding = await input.findThreadBinding(sessionName);
    if (binding) {
      return {
        status: "started",
        sessionName,
        binding,
      };
    }

    await sleepWithAbort(intervalMs, input.signal);
  }

  return {
    status: "timeout",
    sessionName,
  };
}

export function resolveGcAgentRuntimeState(input: {
  isPool: boolean;
  isSuspended: boolean;
  namedSessionMode?: GcNamedSessionMode | undefined;
  actionState?: GcAgentActionState | undefined;
  startPending?: boolean | undefined;
  threads: readonly AgentThreadState[];
}): GcAgentRuntimeState {
  const { actionState } = input;
  if (actionState?.kind === "resume") {
    return { label: "Resuming", tone: "info" };
  }
  if (actionState?.kind === "suspend") {
    return { label: "Suspending", tone: "warning" };
  }
  if (actionState?.kind === "session-mode") {
    return {
      label: actionState.targetMode === "always" ? "Switching to auto" : "Switching to demand",
      tone: "info",
    };
  }
  if (actionState?.kind === "pool-size") {
    return {
      label: `Scaling to ${actionState.maxActiveSessions}`,
      tone: "info",
    };
  }
  if (input.startPending) {
    return { label: "Starting", tone: "info" };
  }
  if (input.isSuspended) {
    return { label: "Suspended", tone: "muted" };
  }

  if (input.threads.some((thread) => isSessionActivelyRunning(thread.session, thread.latestTurn))) {
    return { label: "Running", tone: "success" };
  }

  if (input.threads.some((thread) => thread.session?.status === "connecting")) {
    return { label: "Connecting", tone: "info" };
  }

  if (
    input.threads.some(
      (thread) =>
        thread.session?.status === "ready" || thread.session?.orchestrationStatus === "ready",
    )
  ) {
    return { label: "Ready", tone: "success" };
  }

  if (input.threads.length > 0) {
    return { label: "Bound", tone: "info" };
  }

  if (input.isPool) {
    return { label: "Pool", tone: "muted" };
  }

  if (input.namedSessionMode === "always") {
    return { label: "No session", tone: "warning" };
  }

  if (input.namedSessionMode === "on_demand") {
    return { label: "On demand", tone: "muted" };
  }

  return { label: "Idle", tone: "muted" };
}

export function summarizeGcRuntimeStates(
  states: readonly GcAgentRuntimeState[],
  options?: { suspended?: boolean },
): string {
  if (options?.suspended) {
    return "Suspended";
  }
  if (states.length === 0) {
    return "No agents";
  }

  const countByLabel = new Map<string, number>();
  for (const state of states) {
    countByLabel.set(state.label, (countByLabel.get(state.label) ?? 0) + 1);
  }

  return [...countByLabel.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 2)
    .map(([label, count]) => (count === 1 ? label : `${count} ${label.toLowerCase()}`))
    .join(" · ");
}
