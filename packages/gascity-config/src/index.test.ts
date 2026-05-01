import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertBundledGascityConfigPresent,
  getBundledGcBinaryPath,
  getBundledGascityConfigLayout,
  getDefaultGascityRuntimeRoot,
  materializeGascityConfig,
  materializeGascityRuntime,
} from "./index.ts";

describe("@t3tools/gascity-config", () => {
  it("ships a self-contained city and Gastown packs", () => {
    assertBundledGascityConfigPresent();
    const layout = getBundledGascityConfigLayout();

    const cityToml = readFileSync(layout.cityTomlPath, "utf8");
    expect(cityToml).toContain('name = "t3code"');
    expect(cityToml).toContain('name = "gascity"');
    expect(cityToml).toContain('name = "beads-doltlite"');
    expect(cityToml).toContain("[[patches.agent]]");
    expect(cityToml).toContain("[[patches.named_session]]");
    expect(cityToml).toContain("[beads]");
    expect(readFileSync(layout.packTomlPath, "utf8")).toContain("[imports.gastown]");
    expect(readFileSync(path.join(layout.gastownPackDir, "pack.toml"), "utf8")).toContain(
      "../maintenance",
    );
    expect(readFileSync(path.join(layout.maintenancePackDir, "pack.toml"), "utf8")).toContain(
      "maintenance",
    );
  });

  it("materializes config without runtime state directories", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "t3-gascity-config-"));
    try {
      const layout = materializeGascityConfig({ targetDir: tempDir });

      const cityToml = readFileSync(layout.cityTomlPath, "utf8");
      expect(cityToml).toContain('name = "gascity"');
      expect(cityToml).toContain('name = "beads-doltlite"');
      expect(readFileSync(layout.packTomlPath, "utf8")).toContain("[imports.gastown]");
      expect(readFileSync(path.join(layout.gastownPackDir, "pack.toml"), "utf8")).toContain(
        "../maintenance",
      );
      expect(existsSync(path.join(layout.rootDir, ".gc"))).toBe(false);
      expect(existsSync(path.join(layout.rootDir, ".beads"))).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves platform-specific bundled binary paths", () => {
    expect(getBundledGcBinaryPath({ platform: "linux", arch: "x64" })).toMatch(
      /binaries\/linux-x64\/gc$/u,
    );
    expect(getBundledGcBinaryPath({ platform: "win32", arch: "x64" })).toMatch(
      /binaries\/win32-x64\/gc\.exe$/u,
    );
  });

  it("resolves platform-specific default runtime roots", () => {
    expect(
      getDefaultGascityRuntimeRoot({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local" },
      }),
    ).toBe(path.join("C:\\Users\\Ada\\AppData\\Local", "T3Code", "GasCity", "current"));
    expect(getDefaultGascityRuntimeRoot({ platform: "linux", env: {} })).toContain(
      path.join(".local", "state", "t3code", "gascity", "current"),
    );
  });

  it("materializes config and a supplied gc binary into a runtime directory", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "t3-gascity-runtime-"));
    try {
      const sourceBinary = path.join(tempDir, "source-gc");
      writeFileSync(sourceBinary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const runtime = materializeGascityRuntime({
        targetDir: path.join(tempDir, "runtime"),
        gcBinaryPath: sourceBinary,
      });

      expect(readFileSync(runtime.city.cityTomlPath, "utf8")).toContain('name = "beads-doltlite"');
      const beadsConfig = readFileSync(
        path.join(runtime.city.rootDir, ".beads", "config.yaml"),
        "utf8",
      );
      expect(beadsConfig).toContain("issue_prefix: ci");
      expect(beadsConfig).not.toContain("dolt:");
      expect(beadsConfig).not.toContain("port:");
      expect(readFileSync(runtime.gcBinaryPath, "utf8")).toContain("exit 0");
      expect(statSync(runtime.gcBinaryPath).mode & 0o111).not.toBe(0);
      expect(existsSync(path.join(runtime.rootDir, ".gc"))).toBe(false);
      expect(existsSync(path.join(runtime.rootDir, ".beads"))).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves existing runtime city and beads config when requested", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "t3-gascity-runtime-preserve-"));
    try {
      const sourceBinary = path.join(tempDir, "source-gc");
      writeFileSync(sourceBinary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const runtime = materializeGascityRuntime({
        targetDir: path.join(tempDir, "runtime"),
        gcBinaryPath: sourceBinary,
      });

      writeFileSync(
        runtime.city.cityTomlPath,
        ["[workspace]", 'name = "custom"', "", "[[rigs]]", 'name = "kept"', ""].join("\n"),
      );
      const beadsConfigPath = path.join(runtime.city.rootDir, ".beads", "config.yaml");
      writeFileSync(beadsConfigPath, "issue_prefix: keep\n");

      const replacementBinary = path.join(tempDir, "replacement-gc");
      writeFileSync(replacementBinary, "#!/bin/sh\nexit 7\n", { mode: 0o755 });

      const rematerialized = materializeGascityRuntime({
        targetDir: runtime.rootDir,
        gcBinaryPath: replacementBinary,
        preserveExistingConfig: true,
      });

      expect(readFileSync(rematerialized.city.cityTomlPath, "utf8")).toContain('name = "kept"');
      expect(readFileSync(beadsConfigPath, "utf8")).toBe("issue_prefix: keep\n");
      expect(readFileSync(rematerialized.gcBinaryPath, "utf8")).toContain("exit 7");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
