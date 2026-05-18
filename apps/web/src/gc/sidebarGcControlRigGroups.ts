import type { GcConfigResult } from "@t3tools/contracts";
import type { SidebarGcRigGroup } from "./SidebarGcFolders";

export function globalGcRigGroupsForControlSection(input: {
  readonly rigGroups: readonly SidebarGcRigGroup[];
  readonly gcConfig: GcConfigResult;
}): SidebarGcRigGroup[] {
  return input.rigGroups.filter((rigGroup) => rigGroup.kind === "workspace");
}
