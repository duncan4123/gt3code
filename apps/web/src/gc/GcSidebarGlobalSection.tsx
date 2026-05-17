import { memo, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { SidebarMenuSub } from "../components/ui/sidebar";
import { SidebarGcFolders, type SidebarGcRigGroup } from "./SidebarGcFolders";
import type { GcAgentActionState } from "./sidebar/gcSidebarControls";

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
    <div className="py-1">
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
    </div>
  );
});
