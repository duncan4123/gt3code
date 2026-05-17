import type { VirtualRigGroup } from "@t3tools/contracts";
import type { SidebarThreadSummary } from "../types";
import { resolveGcAgentRuntimeState, type GcAgentActionState } from "./sidebar/gcSidebarControls";
import type { SidebarGcRigGroup } from "./SidebarGcFolders";

export function toSidebarGcRigGroups(
  rigGroups: readonly VirtualRigGroup<SidebarThreadSummary>[],
  input: {
    readonly gcAgentActionStateByAgent: ReadonlyMap<string, GcAgentActionState>;
    readonly gcAgentStartsInFlight: ReadonlySet<string>;
  },
): SidebarGcRigGroup[] {
  return rigGroups.map((rigGroup) => ({
    id: rigGroup.id,
    label: rigGroup.label,
    kind: rigGroup.kind,
    isConfigured: rigGroup.isConfigured,
    isSuspended: rigGroup.isSuspended,
    ...(rigGroup.lifecycle ? { lifecycle: rigGroup.lifecycle } : {}),
    agentGroups: rigGroup.agentGroups.map((agentGroup) => ({
      id: agentGroup.id,
      label: agentGroup.label,
      qualifiedName: agentGroup.qualifiedName,
      isExplicitlySuspended: agentGroup.isExplicitlySuspended,
      isSuspended: agentGroup.isSuspended,
      isPool: agentGroup.isPool,
      ...(typeof agentGroup.minActiveSessions === "number"
        ? { minActiveSessions: agentGroup.minActiveSessions }
        : {}),
      ...(typeof agentGroup.maxActiveSessions === "number"
        ? { maxActiveSessions: agentGroup.maxActiveSessions }
        : {}),
      ...(agentGroup.wakeMode ? { wakeMode: agentGroup.wakeMode } : {}),
      ...(agentGroup.namedSessionMode ? { namedSessionMode: agentGroup.namedSessionMode } : {}),
      ...(agentGroup.scope ? { scope: agentGroup.scope } : {}),
      ...(agentGroup.provider ? { provider: agentGroup.provider } : {}),
      ...(agentGroup.description ? { description: agentGroup.description } : {}),
      ...(agentGroup.workDir ? { workDir: agentGroup.workDir } : {}),
      ...(agentGroup.promptTemplate ? { promptTemplate: agentGroup.promptTemplate } : {}),
      ...(agentGroup.startCommand ? { startCommand: agentGroup.startCommand } : {}),
      ...(agentGroup.defaultSlingFormula
        ? { defaultSlingFormula: agentGroup.defaultSlingFormula }
        : {}),
      runtimeState: resolveGcAgentRuntimeState({
        isPool: agentGroup.isPool,
        isSuspended: agentGroup.isSuspended,
        ...(agentGroup.namedSessionMode ? { namedSessionMode: agentGroup.namedSessionMode } : {}),
        ...(input.gcAgentActionStateByAgent.get(agentGroup.qualifiedName)
          ? { actionState: input.gcAgentActionStateByAgent.get(agentGroup.qualifiedName) }
          : {}),
        ...(input.gcAgentStartsInFlight.has(agentGroup.qualifiedName)
          ? { startPending: true }
          : {}),
        threads: agentGroup.threads.map((thread) => ({
          latestTurn: thread.latestTurn ?? null,
          session: thread.session ?? null,
        })),
      }),
      threadIds: agentGroup.threads.map((thread) => thread.id),
    })),
  }));
}
