import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

    expect(__gcCityTomlPatchForTests.findRigIncludesInCityToml(toml, "beads-doltlite")).toEqual([
      "packs/gastown",
    ]);
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

  it("writes dir-scoped builtin agents as patches, not rig overrides", () => {
    const toml = `[workspace]
name = "t3code"

[patches]
`;

    const next = __gcCityTomlPatchForTests.updateAgentPatchInCityToml(
      toml,
      { dir: "beads-doltlite", template: "control-dispatcher" },
      { suspended: true, maxActiveSessions: 1 },
    );

    expect(next).toContain(`[[patches.agent]]
dir = "beads-doltlite"
name = "control-dispatcher"
max_active_sessions = 1
suspended = true`);
    expect(next).not.toContain("[[rigs.overrides]]");
  });

  it("prefers sibling gc cities over the packaged fallback", () => {
    const root = mkdtempSync(path.join(tmpdir(), "gc-city-discovery-"));
    const repoRoot = path.join(root, "repo");
    const nestedProject = path.join(repoRoot, "projects", "alpha");
    const siblingCity = path.join(repoRoot, "gc");

    mkdirSync(nestedProject, { recursive: true });
    mkdirSync(siblingCity, { recursive: true });
    writeFileSync(path.join(siblingCity, "city.toml"), "[workspace]\nname = \"local\"\n");
    writeFileSync(path.join(siblingCity, "pack.toml"), "[pack]\nname = \"gc\"\n");

    expect(__gcCityTomlPatchForTests.discoverGcCityRoot(nestedProject)).toBe(siblingCity);
  });

  it("does not inject doltlite beads metadata into non-bundled cities", () => {
    const root = mkdtempSync(path.join(tmpdir(), "gc-runtime-"));
    const cityPath = path.join(root, "custom-city");
    const binPath = path.join(root, "gc");

    mkdirSync(cityPath, { recursive: true });
    writeFileSync(path.join(cityPath, "city.toml"), "[workspace]\nname = \"legacy\"\n");
    writeFileSync(path.join(cityPath, "pack.toml"), "[pack]\nname = \"gc\"\n");
    writeFileSync(binPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binPath, 0o755);

    const runtime = __gcCityTomlPatchForTests.ensurePackagedGcRuntime({
      runtimeHome: path.join(root, "runtime"),
      cityPath,
      binaryPath: binPath,
    });

    expect(runtime.cityPath).toBe(cityPath);
    expect(existsSync(path.join(cityPath, ".beads", "metadata.json"))).toBe(false);
  });
});
