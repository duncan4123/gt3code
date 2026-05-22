import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertBundledGascityConfigPresent,
  getBundledBdBinaryPath,
  getBundledGcBinaryPath,
  getBundledGascityConfigLayout,
  getBundledGascityConfigLayouts,
  getDefaultGascityRuntimeRoot,
  materializeGascityConfig,
  materializeGascityRuntime,
  readGascityBeadsConfig,
  usesDoltliteBeadsBackend,
} from "./index.ts";

type TomlValue = boolean | number | string | string[] | Record<string, string>;
type TomlRecord = Record<string, TomlValue>;

function readToml(pathname: string): string {
  return readFileSync(pathname, "utf8");
}

function parseTomlValue(rawValue: string): TomlValue {
  const value = rawValue.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return Array.from(value.matchAll(/"([^"]*)"/gu), (match) => match[1] ?? "");
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    return Object.fromEntries(
      Array.from(value.matchAll(/([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/gu), (match) => [
        match[1] ?? "",
        match[2] ?? "",
      ]),
    );
  }
  const quoted = value.match(/^"([^"]*)"$/u);
  return quoted?.[1] ?? value;
}

function parseTomlLines(lines: readonly string[]): TomlRecord {
  const record: TomlRecord = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("[")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u);
    if (!match) continue;
    const key = match[1] ?? "";
    const value = parseTomlValue(match[2] ?? "");
    if (key === "option_defaults" && typeof value === "object" && !Array.isArray(value)) {
      record.option_defaults = value;
      continue;
    }
    const nested = key.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u);
    if (nested) {
      const parent = nested[1] ?? "";
      const child = nested[2] ?? "";
      const target =
        typeof record[parent] === "object" && !Array.isArray(record[parent])
          ? (record[parent] as Record<string, string>)
          : {};
      target[child] = String(value);
      record[parent] = target;
      continue;
    }
    record[key] = value;
  }
  return record;
}

function tomlArray(content: string, tableName: string): TomlRecord[] {
  const lines = content.split("\n");
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
      if (current) blocks.push(current);
      current = trimmed === `[[${tableName}]]` ? [] : null;
      continue;
    }
    if (trimmed.startsWith("[") && current) {
      current.push(line);
      continue;
    }
    current?.push(line);
  }
  if (current) blocks.push(current);
  return blocks.map(parseTomlLines);
}

function tomlSection(content: string, sectionName: string): TomlRecord {
  if (!sectionName) {
    return parseTomlLines(content.split("\n"));
  }
  const lines = content.split("\n");
  const sectionLines: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (inSection) break;
      inSection = trimmed === `[${sectionName}]`;
      continue;
    }
    if (inSection) sectionLines.push(line);
  }
  return parseTomlLines(sectionLines);
}

function expectStringRecord(value: TomlValue | undefined): Record<string, string> {
  expect(value && typeof value === "object" && !Array.isArray(value)).toBe(true);
  return value as Record<string, string>;
}

describe("@t3tools/gascity-config", () => {
  it("ships a self-contained city and Gastown packs", () => {
    assertBundledGascityConfigPresent();
    const layout = getBundledGascityConfigLayout();
    const cityLayouts = getBundledGascityConfigLayouts();

    const cityToml = readFileSync(layout.cityTomlPath, "utf8");
    expect(layout.rootDir).toContain(path.join("config", "cities", "gastown"));
    expect(cityLayouts.map((city) => path.basename(city.rootDir))).toEqual([
      "gastown",
      "gascity-br",
    ]);
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
    expect(readGascityBeadsConfig(layout.rootDir)).toEqual({
      provider: "bd",
      backend: "doltlite",
    });
    expect(usesDoltliteBeadsBackend(layout.rootDir)).toBe(true);
    expect(readGascityBeadsConfig(getBundledGascityConfigLayout("gascity-br").rootDir)).toEqual({
      provider: "exec:gc-beads-br",
      backend: null,
    });
    expect(usesDoltliteBeadsBackend(getBundledGascityConfigLayout("gascity-br").rootDir)).toBe(
      false,
    );
  });

  it("keeps bundled city and pack TOML aligned with T3Code sidebar controls", () => {
    const gastown = getBundledGascityConfigLayout("gastown");
    const gascityBr = getBundledGascityConfigLayout("gascity-br");
    const gastownCity = readToml(gastown.cityTomlPath);
    const gascityBrCity = readToml(gascityBr.cityTomlPath);
    const gastownPack = readToml(gastown.packTomlPath);
    const doltliteGastownPack = readToml(
      path.join(gastown.packsDir, "doltlite-gastown", "pack.toml"),
    );

    expect(tomlSection(gastownCity, "session")).toMatchObject({ provider: "t3bridge" });
    expect(tomlSection(gascityBrCity, "session")).toMatchObject({ provider: "t3bridge" });
    expect(tomlSection(gastownCity, "beads")).toMatchObject({
      provider: "bd",
      backend: "doltlite",
    });
    expect(tomlSection(gascityBrCity, "beads")).toMatchObject({ provider: "exec:gc-beads-br" });

    expect(tomlSection(gastownPack, "providers.kimi-for-coding")).toMatchObject({
      base: "builtin:opencode",
      supports_acp: false,
    });
    expect(tomlSection(doltliteGastownPack, "providers.kimi-for-coding")).toMatchObject({
      base: "builtin:opencode",
      supports_acp: false,
    });

    const gastownRigs = tomlArray(gastownCity, "rigs");
    const gascityBrRigs = tomlArray(gascityBrCity, "rigs");
    expect(gastownRigs.map((rig) => rig.name)).toEqual([
      "gascity",
      "beads-doltlite",
      "t3code",
      "test-rig",
    ]);
    expect(gascityBrRigs.map((rig) => rig.name)).toEqual(["beads_rust", "agentic-flow", "t3-jj"]);
    for (const rig of [...gastownRigs, ...gascityBrRigs]) {
      expect(rig.name).toEqual(expect.any(String));
      expect(rig.prefix).toEqual(expect.any(String));
      expect(rig.suspended).toEqual(expect.any(Boolean));
      expect(rig.includes).toEqual(expect.arrayContaining([expect.any(String)]));
    }

    const testRig = gastownRigs.find((rig) => rig.name === "test-rig");
    const t3JjRig = gascityBrRigs.find((rig) => rig.name === "t3-jj");
    expect(testRig?.includes).toEqual(expect.arrayContaining(["../../packs/gastown", "packs/jj"]));
    expect(t3JjRig?.includes).toEqual(expect.arrayContaining(["packs/flywheel/all", "packs/jj"]));

    const jjAgents = ["planner", "worker", "lander", "sentinel"];
    for (const city of ["gastown", "gascity-br"] as const) {
      const cityRoot = getBundledGascityConfigLayout(city).rootDir;
      for (const agentName of jjAgents) {
        const agent = tomlSection(
          readToml(path.join(cityRoot, "packs", "jj", "agents", agentName, "agent.toml")),
          "",
        );
        expect(agent.scope).toBe("rig");
        expect(agent.provider).toEqual(expect.any(String));
        expect(agent.work_dir).toEqual(
          expect.stringContaining(
            "{{.WorktreesRoot}}/gascity/{{.CityName}}/{{.Rig}}/jj/agents",
          ),
        );
        expect(agent.wake_mode).toBe("fresh");
        expect(agent.max_active_sessions).toEqual(expect.any(Number));
        const defaults = expectStringRecord(agent.option_defaults);
        expect(defaults.model).toBe(
          agent.provider === "kimi-for-coding" ? "kimi-for-coding/k2p6" : "gpt-5.5",
        );
        if (agent.provider === "kimi-for-coding") {
          expect(defaults.agent).toBe("build");
        }
      }
      const worker = tomlSection(
        readToml(path.join(cityRoot, "packs", "jj", "agents", "worker", "agent.toml")),
        "",
      );
      expect(worker.is_pool).toBe(true);
      expect(worker.min_active_sessions).toBe(1);
      expect(worker.max_active_sessions).toBe(4);
      expect(worker.default_sling_formula).toBe("mol-jj-worker-work");
    }

    const gastownNamed = [
      ...tomlArray(gastownCity, "patches.named_session").filter(
        (session) => session.dir === "test-rig",
      ),
      ...tomlArray(
        readToml(path.join(gastown.rootDir, "packs", "jj", "pack.toml")),
        "named_session",
      ),
    ];
    const gascityBrNamed = tomlArray(gascityBrCity, "patches.named_session").filter(
      (session) => session.dir === "t3-jj",
    );
    expect(new Set(gastownNamed.map((session) => session.template))).toEqual(
      new Set(["lander", "planner", "refinery", "sentinel"]),
    );
    expect(gascityBrNamed.map((session) => session.template).sort()).toEqual([
      "lander",
      "planner",
      "sentinel",
    ]);
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
    expect(getBundledBdBinaryPath({ platform: "linux", arch: "x64" })).toMatch(
      /binaries\/linux-x64\/bd$/u,
    );
    expect(getBundledGcBinaryPath({ platform: "win32", arch: "x64" })).toMatch(
      /binaries\/win32-x64\/gc\.exe$/u,
    );
    expect(getBundledBdBinaryPath({ platform: "win32", arch: "x64" })).toMatch(
      /binaries\/win32-x64\/bd\.exe$/u,
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
      const sourceBdBinary = path.join(tempDir, "source-bd");
      writeFileSync(sourceBinary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      writeFileSync(sourceBdBinary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const runtime = materializeGascityRuntime({
        targetDir: path.join(tempDir, "runtime"),
        gcBinaryPath: sourceBinary,
        bdBinaryPath: sourceBdBinary,
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
      expect(readFileSync(runtime.bdBinaryPath, "utf8")).toContain("exit 0");
      expect(statSync(runtime.gcBinaryPath).mode & 0o111).not.toBe(0);
      expect(statSync(runtime.bdBinaryPath).mode & 0o111).not.toBe(0);
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
      const sourceBdBinary = path.join(tempDir, "source-bd");
      writeFileSync(sourceBinary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      writeFileSync(sourceBdBinary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const runtime = materializeGascityRuntime({
        targetDir: path.join(tempDir, "runtime"),
        gcBinaryPath: sourceBinary,
        bdBinaryPath: sourceBdBinary,
      });

      writeFileSync(
        runtime.city.cityTomlPath,
        ["[workspace]", 'name = "custom"', "", "[[rigs]]", 'name = "kept"', ""].join("\n"),
      );
      const beadsConfigPath = path.join(runtime.city.rootDir, ".beads", "config.yaml");
      writeFileSync(beadsConfigPath, "issue_prefix: keep\n");

      const replacementBinary = path.join(tempDir, "replacement-gc");
      const replacementBdBinary = path.join(tempDir, "replacement-bd");
      writeFileSync(replacementBinary, "#!/bin/sh\nexit 7\n", { mode: 0o755 });
      writeFileSync(replacementBdBinary, "#!/bin/sh\nexit 7\n", { mode: 0o755 });

      const rematerialized = materializeGascityRuntime({
        targetDir: runtime.rootDir,
        gcBinaryPath: replacementBinary,
        bdBinaryPath: replacementBdBinary,
        preserveExistingConfig: true,
      });

      expect(readFileSync(rematerialized.city.cityTomlPath, "utf8")).toContain('name = "kept"');
      expect(readFileSync(beadsConfigPath, "utf8")).toBe("issue_prefix: keep\n");
      expect(readFileSync(rematerialized.gcBinaryPath, "utf8")).toContain("exit 7");
      expect(readFileSync(rematerialized.bdBinaryPath, "utf8")).toContain("exit 7");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
