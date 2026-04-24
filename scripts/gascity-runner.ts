import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { materializeGascityRuntime } from "../packages/gascity-config/src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultRuntimeRoot = join(homedir(), ".local", "state", "t3code", "gascity", "current");

const command = process.argv[2] ?? "help";
const passthroughArgs = process.argv.slice(3);

interface RuntimePaths {
  readonly rootDir: string;
  readonly cityDir: string;
  readonly gcBinaryPath: string;
}

function main(): void {
  switch (command) {
    case "install": {
      const runtime = installRuntime({ overwriteConfig: true });
      printRuntime(runtime);
      return;
    }
    case "dry-run": {
      const runtime = installRuntime({ overwriteConfig: true });
      runGc(runtime, ["start", "--dry-run", ...passthroughArgs]);
      return;
    }
    case "start": {
      const runtime = installRuntime({ overwriteConfig: true });
      runGc(runtime, ["start", ...passthroughArgs]);
      return;
    }
    case "stop": {
      const runtime = getRuntimePaths();
      runGc(runtime, ["stop", ...passthroughArgs]);
      return;
    }
    case "config": {
      const runtime = installRuntime({ overwriteConfig: true });
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
  const targetDir = process.env.T3CODE_GASCITY_HOME ?? defaultRuntimeRoot;
  const runtime = materializeGascityRuntime({
    targetDir,
    overwriteConfig: options.overwriteConfig,
    ...(process.env.GASCITY_BINARY !== undefined
      ? { gcBinaryPath: process.env.GASCITY_BINARY }
      : {}),
  });
  writeDefaultSiteToml(runtime.city.rootDir);
  return {
    rootDir: runtime.rootDir,
    cityDir: runtime.city.rootDir,
    gcBinaryPath: runtime.gcBinaryPath,
  };
}

function getRuntimePaths(): RuntimePaths {
  const rootDir = process.env.T3CODE_GASCITY_HOME ?? defaultRuntimeRoot;
  return {
    rootDir,
    cityDir: join(rootDir, "city"),
    gcBinaryPath: join(rootDir, "bin", process.platform === "win32" ? "gc.exe" : "gc"),
  };
}

function writeDefaultSiteToml(cityDir: string): void {
  const gcDir = join(cityDir, ".gc");
  mkdirSync(gcDir, { recursive: true });
  writeFileSync(
    join(gcDir, "site.toml"),
    "# T3Code packaged city starts with no rig bindings. Add rigs explicitly from the app.\n",
  );
}

function runGc(runtime: RuntimePaths, args: ReadonlyArray<string>): never {
  const result = spawnSync(runtime.gcBinaryPath, ["--city", runtime.cityDir, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      GC_HOME: runtime.rootDir,
      T3CODE_GASCITY_HOME: runtime.rootDir,
      GC_CITY_PATH: runtime.cityDir,
      GC_BIN: runtime.gcBinaryPath,
      GC_API_URL: "http://127.0.0.1:8372",
    },
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

function printRuntime(runtime: RuntimePaths): void {
  console.log(`T3CODE_GASCITY_HOME=${runtime.rootDir}`);
  console.log(`GC_CITY_PATH=${runtime.cityDir}`);
  console.log(`GC_BIN=${runtime.gcBinaryPath}`);
  console.log("GC_API_URL=http://127.0.0.1:8372");
}

function printHelp(): void {
  console.log(`Usage: bun gascity:<command>

Commands:
  bun gascity:install   Materialize bundled GC binary and config
  bun gascity:dry-run   Show agents GC would start without side effects
  bun gascity:start     Start GC using the bundled runtime
  bun gascity:stop      Stop GC sessions for the bundled runtime
  bun gascity:config    Show resolved GC config
  bun gascity:path      Print runtime paths

Env:
  T3CODE_GASCITY_HOME   Override runtime dir
  GASCITY_BINARY        Override bundled gc binary`);
}

main();
