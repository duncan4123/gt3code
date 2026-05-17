import { describe, expect, it } from "vitest";

import { isGcSidebarFolderExpanded } from "./gcSidebarUiStateStore";

describe("GC sidebar UI state", () => {
  it("treats folders as expanded until the user changes them", () => {
    expect(isGcSidebarFolderExpanded({}, "rig:user-city/customer-api")).toBe(true);
  });

  it("reads persisted open and closed folder states by stable folder id", () => {
    expect(
      isGcSidebarFolderExpanded(
        {
          "rig:user-city/customer-api": false,
          "agent:user-city/customer-api/planner": true,
        },
        "rig:user-city/customer-api",
      ),
    ).toBe(false);
    expect(
      isGcSidebarFolderExpanded(
        {
          "rig:user-city/customer-api": false,
          "agent:user-city/customer-api/planner": true,
        },
        "agent:user-city/customer-api/planner",
      ),
    ).toBe(true);
  });
});
