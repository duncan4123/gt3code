import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findBuiltBdBinaryPath } from "@t3tools/beads-doltlite";
import { findBuiltGcBinaryPath } from "@t3tools/gascity";
import {
  getBundledGascityConfigLayout,
  getDefaultGascityRuntimeRoot,
} from "../packages/gascity-config/src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultRuntimeRoot = getDefaultGascityRuntimeRoot();
const defaultCityRoot = getBundledGascityConfigLayout().rootDir;
const defaultRigBindings = [
  { name: "gascity", path: "/data/projects/gascity-t3code" },
  { name: "beads-doltlite", path: "/data/projects/beads-doltlite" },
] as const;

const command = process.argv[2] ?? "help";
const passthroughArgs = process.argv.slice(3);

interface RuntimePaths {
  readonly rootDir: string;
  readonly cityDir: string;
  readonly gcBinaryPath: string;
  readonly bdBinaryPath: string;
  readonly worktreesDir: string;
}

function main(): void {
  switch (command) {
    case "install": {
      const runtime = installRuntime({ overwriteConfig: shouldOverwriteInstallConfig() });
      printRuntime(runtime);
      return;
    }
    case "dry-run": {
      const runtime = ensureRuntimeInstalled();
      runGc(runtime, ["start", "--dry-run", ...passthroughArgs]);
      return;
    }
    case "gc": {
      const runtime = ensureRuntimeInstalled();
      runGc(runtime, passthroughArgs);
      return;
    }
    case "status": {
      const runtime = ensureRuntimeInstalled();
      runGc(runtime, ["status", ...passthroughArgs]);
      return;
    }
    case "start": {
      const runtime = ensureRuntimeInstalled();
      runGc(runtime, ["start", ...passthroughArgs]);
      return;
    }
    case "stop": {
      const runtime = getRuntimePaths();
      runGc(runtime, ["stop", ...passthroughArgs]);
      return;
    }
    case "config": {
      const runtime = ensureRuntimeInstalled();
      runGc(runtime, ["config", "show", ...passthroughArgs]);
      return;
    }
    case "path": {
      printRuntime(getRuntimePaths());
      return;
    }
    default:
      printHelp();
  }
}

function installRuntime(options: { readonly overwriteConfig: boolean }): RuntimePaths {
  if (options.overwriteConfig) {
    console.warn(
      "gascity:install no longer overwrites config; packages/gascity-config/config is the active city.",
    );
  }
  const rootDir = process.env.T3CODE_GASCITY_HOME ?? defaultRuntimeRoot;
  const gcBinarySource = process.env.GASCITY_BINARY ?? findBuiltGcBinaryPath();
  const bdBinarySource = process.env.BD_BINARY ?? findBuiltBdBinaryPath();
  if (!gcBinarySource) {
    throw new Error("No built Gas City binary is available. Run bun build:gascity-tools.");
  }
  if (!bdBinarySource) {
    throw new Error("No built beads binary is available. Run bun build:gascity-tools.");
  }
  const runtime = getRuntimePaths();
  mkdirSync(dirname(runtime.gcBinaryPath), { recursive: true });
  copyRuntimeBinary(gcBinarySource, runtime.gcBinaryPath);
  copyRuntimeBinary(bdBinarySource, runtime.bdBinaryPath);
  prepareActiveCity(defaultCityRoot);
  return {
    rootDir,
    cityDir: defaultCityRoot,
    gcBinaryPath: runtime.gcBinaryPath,
    bdBinaryPath: runtime.bdBinaryPath,
    worktreesDir: runtime.worktreesDir,
  };
}

function ensureRuntimeInstalled(): RuntimePaths {
  const runtime = getRuntimePaths();
  if (
    existsSync(runtime.cityDir) &&
    existsSync(runtime.gcBinaryPath) &&
    existsSync(runtime.bdBinaryPath)
  ) {
    prepareActiveCity(runtime.cityDir);
    return runtime;
  }
  return installRuntime({ overwriteConfig: false });
}

function getRuntimePaths(): RuntimePaths {
  const rootDir = process.env.T3CODE_GASCITY_HOME ?? defaultRuntimeRoot;
  return {
    rootDir,
    cityDir: process.env.GC_CITY_PATH ?? process.env.GC_CITY ?? defaultCityRoot,
    gcBinaryPath: join(rootDir, "bin", process.platform === "win32" ? "gc.exe" : "gc"),
    bdBinaryPath: join(rootDir, "bin", process.platform === "win32" ? "bd.exe" : "bd"),
    worktreesDir:
      process.env.T3CODE_WORKTREES_DIR ??
      join(process.env.T3CODE_HOME?.trim() || join(homedir(), ".t3"), "worktrees"),
  };
}

function prepareActiveCity(cityDir: string): void {
  writeDefaultSiteToml(cityDir);
  writeDefaultBeadsConfig(cityDir);
}

function writeDefaultSiteToml(cityDir: string): void {
  const gcDir = join(cityDir, ".gc");
  const siteTomlPath = join(gcDir, "site.toml");
  mkdirSync(gcDir, { recursive: true });
  let content = existsSync(siteTomlPath)
    ? readFileSync(siteTomlPath, "utf8")
    : "# T3Code packaged city keeps machine-local rig path bindings here.\n";
  for (const binding of defaultRigBindings) {
    if (!existsSync(binding.path) || content.includes(`name = "${binding.name}"`)) {
      continue;
    }
    content += `\n[[rig]]\nname = "${binding.name}"\npath = "${binding.path}"\n`;
  }
  writeFileSync(siteTomlPath, content);
}

function writeDefaultBeadsConfig(cityDir: string): void {
  const beadsDir = join(cityDir, ".beads");
  mkdirSync(beadsDir, { recursive: true });
  const configPath = join(beadsDir, "config.yaml");
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      ["issue_prefix: t3", "issue-prefix: t3", "dolt.auto-start: false", ""].join("\n"),
    );
  }
  const metadataPath = join(beadsDir, "metadata.json");
  if (!existsSync(metadataPath)) {
    writeFileSync(
      metadataPath,
      `${JSON.stringify(
        {
          backend: "doltlite",
          database: "doltlite",
          dolt_database: "hq",
          dolt_mode: "embedded",
        },
        null,
        2,
      )}\n`,
    );
  }
}

function copyRuntimeBinary(sourcePath: string, targetPath: string): void {
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  try {
    copyFileSync(sourcePath, tempPath);
    if (process.platform !== "win32") {
      chmodSync(tempPath, 0o755);
    }
    renameSync(tempPath, targetPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function runGc(runtime: RuntimePaths, args: ReadonlyArray<string>): never {
  const env = {
    ...process.env,
    GC_HOME: runtime.rootDir,
    T3CODE_GASCITY_HOME: runtime.rootDir,
    GC_CITY_PATH: runtime.cityDir,
    GC_BIN: runtime.gcBinaryPath,
    BD_BIN: runtime.bdBinaryPath,
    T3CODE_WORKTREES_DIR: runtime.worktreesDir,
    GC_WORKTREES_DIR: runtime.worktreesDir,
    GC_API_URL: "http://127.0.0.1:8372",
  };
  prependRuntimeBinToPath(env, dirname(runtime.gcBinaryPath));
  const result = spawnSync(runtime.gcBinaryPath, ["--city", runtime.cityDir, ...args], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

function prependRuntimeBinToPath(env: NodeJS.ProcessEnv, binDir: string): void {
  const key =
    process.platform === "win32"
      ? (Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "Path")
      : "PATH";
  const separator = process.platform === "win32" ? ";" : ":";
  env[key] = [binDir, env[key]].filter(Boolean).join(separator);
}

function printRuntime(runtime: RuntimePaths): void {
  console.log(`T3CODE_GASCITY_HOME=${runtime.rootDir}`);
  console.log(`GC_CITY_PATH=${runtime.cityDir}`);
  console.log(`GC_BIN=${runtime.gcBinaryPath}`);
  console.log(`BD_BIN=${runtime.bdBinaryPath}`);
  console.log(`T3CODE_WORKTREES_DIR=${runtime.worktreesDir}`);
  console.log("GC_API_URL=http://127.0.0.1:8372");
}

function printHelp(): void {
  console.log(`Usage: bun gascity:<command>

Commands:
  bun gascity:install   Install built GC and bd binaries; use repo packaged city
  bun gascity:dry-run   Show agents GC would start without side effects
  bun gascity:status    Show bundled city status
  bun gascity:start     Start GC using the bundled runtime
  bun gascity:stop      Stop GC sessions for the bundled runtime
  bun gascity:config    Show resolved GC config
  bun gascity:path      Print runtime paths
  bun gc -- <args>      Run bundled gc with the packaged city

Env:
  T3CODE_GASCITY_HOME   Override runtime dir
  T3CODE_WORKTREES_DIR  Override shared T3Code/Gas City worktree root
  GC_CITY_PATH          Override active city dir
  GASCITY_BINARY        Override built gc binary
  BD_BINARY             Override built bd binary

Install flags:
  --overwrite-config    Deprecated no-op; config lives in packages/gascity-config/config
  --force               Deprecated alias for --overwrite-config`);
}

function shouldOverwriteInstallConfig(): boolean {
  for (const arg of passthroughArgs) {
    switch (arg) {
      case "--overwrite-config":
      case "--force":
        return true;
      default:
        console.error(`Unknown gascity:install flag: ${arg}`);
        process.exit(1);
    }
  }
  return false;
}

main();
