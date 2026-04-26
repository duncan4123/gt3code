import { describe, expect, it } from "vitest";

import { __gcCityTomlPatchForTests } from "./GcApiClient.ts";

describe("GC city.toml patch helpers", () => {
  it("reads rig includes without treating overrides as separate rigs", () => {
    const toml = `[workspace]
name = "t3code"

[[rigs]]
name = "beads-doltlite"
path = "/tmp/beads"
includes = ["packs/gastown"]

[[rigs.overrides]]
agent = "polecat"
suspended = true

[patches]
`;

    expect(
      __gcCityTomlPatchForTests.findRigIncludesInCityToml(toml, "beads-doltlite"),
    ).toEqual(["packs/gastown"]);
  });

  it("writes suspended patches for any city pack agent", () => {
    let toml = `[workspace]
name = "t3code"

[patches]
`;

    for (const name of ["boot", "deacon", "mayor"]) {
      toml = __gcCityTomlPatchForTests.updateAgentPatchInCityToml(
        toml,
        { dir: "", template: name },
        { suspended: true },
      );
    }

    for (const name of ["boot", "deacon", "mayor"]) {
      expect(toml).toContain(`name = "${name}"`);
    }
    expect(toml.match(/\[\[patches\.agent\]\]/g)).toHaveLength(3);
    expect(toml.match(/suspended = true/g)).toHaveLength(3);
  });

  it("writes rig-scoped suspended overrides inside the selected rig", () => {
    const toml = `[workspace]
name = "t3code"

[[rigs]]
name = "alpha"
path = "/tmp/alpha"
suspended = true

[[rigs]]
name = "beta"
path = "/tmp/beta"
suspended = false

[patches]
`;

    const next = __gcCityTomlPatchForTests.updateRigOverrideSuspended(
      toml,
      "beta",
      "polecat",
      true,
    );

    expect(next).toContain(`name = "beta"`);
    expect(next).toContain(`path = "/tmp/beta"`);
    expect(next).toContain(`[[rigs.overrides]]
agent = "polecat"
suspended = true`);
    expect(next.indexOf(`agent = "polecat"`)).toBeGreaterThan(next.indexOf(`name = "beta"`));
    expect(next.indexOf(`agent = "polecat"`)).toBeLessThan(next.indexOf(`[patches]`));
  });
});
