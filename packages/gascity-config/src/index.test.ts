import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertBundledGascityConfigPresent,
  getBundledGcBinaryPath,
  getBundledGascityConfigLayout,
  materializeGascityConfig,
  materializeGascityRuntime,
} from "./index.ts";

describe("@t3tools/gascity-config", () => {
  it("ships a self-contained city and Gastown packs", () => {
    assertBundledGascityConfigPresent();
    const layout = getBundledGascityConfigLayout();

    expect(readFileSync(layout.cityTomlPath, "utf8")).not.toContain("[[rigs]]");
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

      expect(readFileSync(layout.cityTomlPath, "utf8")).not.toContain("[[rigs]]");
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

  it("materializes config and a supplied gc binary into a runtime directory", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "t3-gascity-runtime-"));
    try {
      const sourceBinary = path.join(tempDir, "source-gc");
      writeFileSync(sourceBinary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const runtime = materializeGascityRuntime({
        targetDir: path.join(tempDir, "runtime"),
        gcBinaryPath: sourceBinary,
      });

      expect(readFileSync(runtime.city.cityTomlPath, "utf8")).not.toContain("[[rigs]]");
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
});
