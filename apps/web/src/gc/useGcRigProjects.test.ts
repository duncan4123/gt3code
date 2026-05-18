import { describe, expect, it } from "vitest";
import type { GcConfigResult } from "@t3tools/contracts";

import { resolveMissingGcRigProjects } from "./useGcRigProjects";

const baseConfig = {
  workspace: {
    name: "cities",
    path: "/any/root/for/user-defined-cities",
    suspended: false,
  },
  agents: [],
  providers: [],
} satisfies Omit<GcConfigResult, "rigs">;

describe("resolveMissingGcRigProjects", () => {
  it("creates project folders for rigs but never for city roots", () => {
    const missing = resolveMissingGcRigProjects({
      projects: [],
      pendingCwds: new Set(),
      gcConfig: {
        ...baseConfig,
        rigs: [
          {
            name: "alpha-city",
            path: "/custom/cities/alpha-city",
            suspended: false,
            isRepository: true,
          },
          {
            name: "alpha-city/build-rig",
            path: "/custom/workspaces/build-rig",
            suspended: false,
            isRepository: true,
          },
          {
            name: "beta_city",
            path: "/elsewhere/beta_city",
            suspended: false,
            isRepository: true,
          },
          {
            name: "beta_city/data.pipeline",
            path: "/elsewhere/projects/data.pipeline",
            suspended: false,
            isRepository: true,
          },
        ],
      },
    });

    expect(missing.map((rig) => rig.name)).toEqual([
      "alpha-city/build-rig",
      "beta_city/data.pipeline",
    ]);
  });
});
