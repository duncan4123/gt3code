import { describe, expect, it } from "vitest";
import type { GcConfigResult } from "@t3tools/contracts";
import type { SidebarGcRigGroup } from "./SidebarGcFolders";
import { globalGcRigGroupsForControlSection } from "./sidebarGcControlRigGroups";

const baseConfig = {
  workspace: {
    name: "cities",
    path: "/cities",
    suspended: false,
  },
  agents: [],
  providers: [],
} satisfies Omit<GcConfigResult, "rigs">;

function rigGroup(id: string, kind: SidebarGcRigGroup["kind"]): SidebarGcRigGroup {
  return {
    id,
    label: id,
    kind,
    isConfigured: true,
    isSuspended: false,
    agentGroups: [],
  };
}

describe("globalGcRigGroupsForControlSection", () => {
  it("keeps only city control folders", () => {
    const result = globalGcRigGroupsForControlSection({
      gcConfig: {
        ...baseConfig,
        rigs: [
          {
            name: "customer-city",
            path: "/anywhere/customer-city",
            suspended: false,
            isRepository: true,
          },
          {
            name: "customer-city/primary-rig",
            path: "/elsewhere/primary-rig",
            suspended: false,
            isRepository: true,
          },
          {
            name: "customer-city/generated-rig",
            path: "",
            suspended: false,
            isRepository: false,
          },
        ],
      },
      rigGroups: [
        rigGroup("customer-city", "workspace"),
        rigGroup("customer-city/primary-rig", "rig"),
        rigGroup("customer-city/generated-rig", "rig"),
      ],
    });

    expect(result.map((group) => group.id)).toEqual(["customer-city"]);
  });
});
