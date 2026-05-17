import { memo, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { VirtualRigGroup } from "@t3tools/contracts";
import type { SidebarThreadSummary } from "../types";
import { SidebarGroup, SidebarMenuSub } from "../components/ui/sidebar";
import { SidebarGcFolders, type SidebarGcRigGroup } from "./SidebarGcFolders";
import { resolveGcAgentRuntimeState, type GcAgentActionState } from "./sidebar/gcSidebarControls";

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

interface GcSidebarGlobalSectionProps {
  rigGroups: readonly SidebarGcRigGroup[];
  gcAgentMutationsInFlight: ReadonlySet<string>;
  gcAgentStartsInFlight: ReadonlySet<string>;
  gcRigMutationsInFlight: ReadonlySet<string>;
  gcCityMutationInFlight: boolean;
  gcAgentActionStateByAgent: ReadonlyMap<string, GcAgentActionState>;
  gcRigActionStateByRig: ReadonlyMap<string, "resume" | "suspend">;
  gcCityActionState: "resume" | "suspend" | null;
  onToggleCitySuspended: (
    suspended: boolean,
    affectedAgents: readonly SidebarGcRigGroup["agentGroups"][number][],
  ) => void;
  onToggleRigSuspended: (
    rig: string,
    suspended: boolean,
    affectedAgents: readonly SidebarGcRigGroup["agentGroups"][number][],
  ) => void;
  onToggleAgentSuspended: (
    agent: string,
    suspended: boolean,
    agentGroup: SidebarGcRigGroup["agentGroups"][number],
  ) => void;
  onAdjustAgentMaxActiveSessions: (agent: string, maxActiveSessions: number) => void;
  onToggleAgentSessionMode: (agent: string, mode: "always" | "on_demand") => void;
}

export const GcSidebarGlobalSection = memo(function GcSidebarGlobalSection(
  props: GcSidebarGlobalSectionProps,
) {
  const [collapsed, setCollapsed] = useState(false);
  if (props.rigGroups.length === 0) {
    return null;
  }

  return (
    <SidebarGroup className="px-2 py-2">
      <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
        <button
          type="button"
          data-thread-selection-safe
          className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 text-[10px] font-medium tracking-wider text-muted-foreground/60 uppercase hover:bg-accent hover:text-foreground"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronRightIcon
            className={`size-3 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
          <span>Gas City</span>
        </button>
      </div>
      {!collapsed ? (
        <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0">
          <SidebarGcFolders
            rigGroups={props.rigGroups}
            workspaceActionScope="rig"
            gcAgentMutationsInFlight={props.gcAgentMutationsInFlight}
            gcAgentStartsInFlight={props.gcAgentStartsInFlight}
            gcRigMutationsInFlight={props.gcRigMutationsInFlight}
            gcCityMutationInFlight={props.gcCityMutationInFlight}
            gcThreadGroupingMode="agent"
            gcAgentActionStateByAgent={props.gcAgentActionStateByAgent}
            gcRigActionStateByRig={props.gcRigActionStateByRig}
            gcCityActionState={props.gcCityActionState}
            onToggleCitySuspended={props.onToggleCitySuspended}
            onToggleRigSuspended={props.onToggleRigSuspended}
            onToggleAgentSuspended={props.onToggleAgentSuspended}
            onAdjustAgentMinActiveSessions={() => undefined}
            onAdjustAgentMaxActiveSessions={props.onAdjustAgentMaxActiveSessions}
            onWakeAgentSession={() => undefined}
            onToggleAgentWakeMode={() => undefined}
            onToggleAgentSessionMode={props.onToggleAgentSessionMode}
            renderThreadRows={() => null}
          />
        </SidebarMenuSub>
      ) : null}
    </SidebarGroup>
  );
});
