import { EllipsisIcon, LoaderCircleIcon, PlayIcon, SquareIcon } from "lucide-react";

import { Menu, MenuGroup, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import type { SidebarGcRigGroup } from "./SidebarGcFolders";

interface GcRigProjectActionsMenuProps {
  rigGroups: readonly SidebarGcRigGroup[];
  gcRigMutationsInFlight: ReadonlySet<string>;
  onToggleRigSuspended: (
    rig: string,
    suspended: boolean,
    affectedAgents: readonly SidebarGcRigGroup["agentGroups"][number][],
  ) => void;
}

export function GcRigProjectActionsMenu(props: GcRigProjectActionsMenuProps) {
  const rigGroups = props.rigGroups.filter((rigGroup) => rigGroup.kind === "rig");
  if (rigGroups.length === 0) {
    return null;
  }

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              aria-label="Gas City rig actions"
              data-testid="gc-rig-project-actions-menu"
              className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              onClick={(event) => {
                event.stopPropagation();
              }}
            />
          }
        >
          <EllipsisIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">Gas City rig actions</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          {rigGroups.map((rigGroup) => {
            const isMutating = props.gcRigMutationsInFlight.has(rigGroup.id);
            const disabled = isMutating || rigGroup.isConfigured === false;
            const nextSuspended = !rigGroup.isSuspended;
            const label = `${rigGroup.isSuspended ? "Start" : "Suspend"} ${
              rigGroups.length === 1 ? "rig" : rigGroup.label || rigGroup.id
            }`;
            return (
              <MenuItem
                key={rigGroup.id}
                disabled={disabled}
                onClick={() => {
                  props.onToggleRigSuspended(rigGroup.id, nextSuspended, rigGroup.agentGroups);
                }}
              >
                {isMutating ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : rigGroup.isSuspended ? (
                  <PlayIcon className="size-4" />
                ) : (
                  <SquareIcon className="size-4" />
                )}
                <span>{label}</span>
              </MenuItem>
            );
          })}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
