import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

import { findBuiltBdBinaryPath, findBuiltDoltliteLibraryPath } from "@t3tools/beads-doltlite";
import { findBuiltGcBinaryPath } from "@t3tools/gascity";
import {
  getBundledGascityConfigLayout,
  getDefaultGascityRuntimeRoot,
} from "@t3tools/gascity-config";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectsRoot = dirname(repoRoot);
const defaultRuntimeRoot = getDefaultGascityRuntimeRoot();
const defaultCityRoot = getBundledGascityConfigLayout().rootDir;
const defaultRigBindings = [
  { name: "gascity", path: join(projectsRoot, "gascity") },
  { name: "beads-doltlite", path: join(projectsRoot, "beads-doltlite") },
  { name: "context-mode", path: join(projectsRoot, "claude-context-mode") },
] as const;

const command = process.argv[2] ?? "help";
const passthroughArgs = process.argv.slice(3);

interface RuntimePaths {
  readonly rootDir: string;
  readonly cityDir: string;
  readonly gcBinaryPath: string;
  readonly bdBinaryPath: string;
  readonly doltliteLibraryPath: string;
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
  const doltliteLibrarySource = process.env.DOLTLITE_LIBRARY ?? findBuiltDoltliteLibraryPath();
  if (!gcBinarySource) {
    throw new Error("No built Gas City binary is available. Run bun build:gascity-tools.");
  }
  if (!bdBinarySource) {
    throw new Error("No built beads binary is available. Run bun build:gascity-tools.");
  }
  if (!doltliteLibrarySource && process.platform !== "win32") {
    throw new Error("No built Doltlite runtime library is available. Run bun build:gascity-tools.");
  }
  const runtime = getRuntimePaths();
  mkdirSync(dirname(runtime.gcBinaryPath), { recursive: true });
  copyRuntimeBinary(gcBinarySource, runtime.gcBinaryPath);
  copyRuntimeBinary(bdBinarySource, runtime.bdBinaryPath);
  if (doltliteLibrarySource) {
    copyRuntimeFile(doltliteLibrarySource, runtime.doltliteLibraryPath);
  }
  prepareActiveCity(defaultCityRoot, {
    bdBinaryPath: runtime.bdBinaryPath,
    initializeStores: true,
  });
  return {
    rootDir,
    cityDir: defaultCityRoot,
    gcBinaryPath: runtime.gcBinaryPath,
    bdBinaryPath: runtime.bdBinaryPath,
    doltliteLibraryPath: runtime.doltliteLibraryPath,
    worktreesDir: runtime.worktreesDir,
  };
}

function ensureRuntimeInstalled(): RuntimePaths {
  const runtime = getRuntimePaths();
  const gcBinarySource = process.env.GASCITY_BINARY ?? findBuiltGcBinaryPath();
  const bdBinarySource = process.env.BD_BINARY ?? findBuiltBdBinaryPath();
  const doltliteLibrarySource = process.env.DOLTLITE_LIBRARY ?? findBuiltDoltliteLibraryPath();
  if (runtimeMatchesSources(runtime, { gcBinarySource, bdBinarySource, doltliteLibrarySource })) {
    prepareActiveCity(runtime.cityDir, { initializeStores: false });
    return runtime;
  }
  return installRuntime({ overwriteConfig: false });
}

function runtimeMatchesSources(
  runtime: RuntimePaths,
  sources: {
    readonly gcBinarySource: string | undefined;
    readonly bdBinarySource: string | undefined;
    readonly doltliteLibrarySource: string | undefined;
  },
): boolean {
  if (!existsSync(runtime.cityDir)) return false;
  if (!sources.gcBinarySource || !sameFileHash(sources.gcBinarySource, runtime.gcBinaryPath)) {
    return false;
  }
  if (!sources.bdBinarySource || !sameFileHash(sources.bdBinarySource, runtime.bdBinaryPath)) {
    return false;
  }
  if (process.platform !== "win32") {
    if (
      !sources.doltliteLibrarySource ||
      !sameFileHash(sources.doltliteLibrarySource, runtime.doltliteLibraryPath)
    ) {
      return false;
    }
  }
  return true;
}

function sameFileHash(left: string, right: string): boolean {
  return existsSync(left) && existsSync(right) && sha256File(left) === sha256File(right);
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function getRuntimePaths(): RuntimePaths {
  const rootDir = process.env.T3CODE_GASCITY_HOME ?? defaultRuntimeRoot;
  return {
    rootDir,
    cityDir: process.env.GC_CITY_PATH ?? process.env.GC_CITY ?? defaultCityRoot,
    gcBinaryPath: join(rootDir, "bin", process.platform === "win32" ? "gc.exe" : "gc"),
    bdBinaryPath: join(rootDir, "bin", process.platform === "win32" ? "bd.exe" : "bd"),
    doltliteLibraryPath: join(
      rootDir,
      "bin",
      process.platform === "darwin"
        ? "libdoltlite.dylib"
        : process.platform === "win32"
          ? "doltlite.dll"
          : "libdoltlite.so",
    ),
    worktreesDir:
      process.env.T3CODE_WORKTREES_DIR ??
      join(process.env.T3CODE_HOME?.trim() || join(homedir(), ".t3"), "worktrees"),
  };
}

function prepareActiveCity(
  cityDir: string,
  options: { readonly bdBinaryPath?: string; readonly initializeStores: boolean },
): void {
  writeDefaultSiteToml(cityDir);
  writeDefaultBeadsConfig(cityDir, "t3", "hq");
  if (options.initializeStores) {
    if (!options.bdBinaryPath)
      throw new Error("bd binary path is required to initialize beads stores");
    initializeDoltliteBeadsStore(options.bdBinaryPath, cityDir, "t3");
  }
  for (const binding of defaultRigBindings) {
    if (existsSync(binding.path)) {
      const issuePrefix = beadsPrefixForRig(binding.name);
      writeDefaultBeadsConfig(binding.path, issuePrefix, issuePrefix);
      if (options.initializeStores) {
        if (!options.bdBinaryPath)
          throw new Error("bd binary path is required to initialize beads stores");
        initializeDoltliteBeadsStore(options.bdBinaryPath, binding.path, issuePrefix);
      }
    }
  }
}

function initializeDoltliteBeadsStore(
  bdBinaryPath: string,
  scopeDir: string,
  issuePrefix: string,
): void {
  const result = spawnSync(
    bdBinaryPath,
    [
      "init",
      "--backend",
      "doltlite",
      "--prefix",
      issuePrefix,
      "--skip-agents",
      "--skip-hooks",
      "--non-interactive",
      "--quiet",
    ],
    {
      cwd: scopeDir,
      encoding: "utf8",
      env: prepareBdInitEnv(dirname(bdBinaryPath), {
        ...withoutDoltliteInitServerEnv(process.env),
        BEADS_DIR: join(scopeDir, ".beads"),
      }),
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to initialize doltlite beads store at ${scopeDir}: ${result.stderr || result.stdout}`,
    );
  }
}

function prepareBdInitEnv(binDir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...env,
    BEADS_BACKEND: "doltlite",
    GC_BEADS_BACKEND: "doltlite",
  };
  prependPathEnv(next, "PATH", binDir);
  if (process.platform === "linux") {
    next.LD_LIBRARY_PATH = binDir;
  } else if (process.platform === "darwin") {
    next.DYLD_LIBRARY_PATH = binDir;
  }
  return next;
}

function withoutDoltliteInitServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (
      key === "BEADS_DOLT_SERVER_MODE" ||
      key === "BEADS_DOLT_SHARED_SERVER" ||
      key === "BEADS_DOLT_HOST" ||
      key === "BEADS_DOLT_PORT" ||
      key === "BEADS_DOLT_SERVER_HOST" ||
      key === "BEADS_DOLT_SERVER_PORT" ||
      key === "GC_DOLT_HOST" ||
      key === "GC_DOLT_PORT" ||
      key === "GC_DOLT_SERVER_PORT"
    ) {
      delete next[key];
    }
  }
  return next;
}

function writeDefaultSiteToml(cityDir: string): void {
  const gcDir = join(cityDir, ".gc");
  const siteTomlPath = join(gcDir, "site.toml");
  mkdirSync(gcDir, { recursive: true });
  let content = existsSync(siteTomlPath)
    ? readFileSync(siteTomlPath, "utf8")
    : "# T3Code packaged city keeps machine-local rig path bindings here.\n";
  for (const binding of defaultRigBindings) {
    if (!existsSync(binding.path)) {
      continue;
    }
    content = replaceOrAppendRigBinding(content, binding);
  }
  writeFileSync(siteTomlPath, content);
}

function replaceOrAppendRigBinding(
  content: string,
  binding: { readonly name: string; readonly path: string },
): string {
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== "[[rig]]") continue;
    let blockEnd = index + 1;
    let foundName = false;
    let pathLineIndex = -1;
    while (blockEnd < lines.length && lines[blockEnd]?.trim() !== "[[rig]]") {
      const trimmed = lines[blockEnd]?.trim() ?? "";
      if (trimmed === `name = "${binding.name}"`) {
        foundName = true;
      }
      if (trimmed.startsWith("path =")) {
        pathLineIndex = blockEnd;
      }
      blockEnd += 1;
    }
    if (!foundName) {
      index = blockEnd - 1;
      continue;
    }
    const pathLine = `path = "${binding.path}"`;
    if (pathLineIndex >= 0) {
      lines[pathLineIndex] = pathLine;
    } else {
      lines.splice(blockEnd, 0, pathLine);
    }
    return lines.join("\n");
  }
  return `${content.replace(/\s*$/, "")}\n\n[[rig]]\nname = "${binding.name}"\npath = "${binding.path}"\n`;
}

function beadsPrefixForRig(name: string): string {
  switch (name) {
    case "gascity":
      return "ga";
    case "beads-doltlite":
      return "bd";
    case "context-mode":
      return "ccm";
    default:
      return "gc";
  }
}

function writeDefaultBeadsConfig(cityDir: string, issuePrefix: string, doltDatabase: string): void {
  const beadsDir = join(cityDir, ".beads");
  mkdirSync(beadsDir, { recursive: true });
  const configPath = join(beadsDir, "config.yaml");
  const configContent = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  writeFileSync(
    configPath,
    ensureYamlScalarLines(configContent, {
      issue_prefix: issuePrefix,
      "issue-prefix": issuePrefix,
      "dolt.auto-start": "false",
      "dolt.shared-server": "false",
      "export.auto": "false",
      "types.custom":
        '"molecule,convoy,message,event,gate,merge-request,agent,role,rig,session,spec,convergence"',
    }),
  );
  const metadataPath = join(beadsDir, "metadata.json");
  const metadata = readJsonObject(metadataPath);
  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        ...metadata,
        backend: "doltlite",
        database: "doltlite",
        dolt_database: doltDatabase,
        dolt_mode: "embedded",
      },
      null,
      2,
    )}\n`,
  );
}

function ensureYamlScalarLines(content: string, values: Record<string, string>): string {
  const lines = content
    .split("\n")
    .filter((line, index, all) => index < all.length - 1 || line !== "");
  for (const [key, value] of Object.entries(values)) {
    const nextLine = `${key}: ${value}`;
    const index = lines.findIndex((line) => line.trimStart().startsWith(`${key}:`));
    if (index >= 0) {
      lines[index] = nextLine;
    } else {
      lines.push(nextLine);
    }
  }
  return `${lines.join("\n").replace(/\s*$/, "")}\n`;
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Local runtime metadata can be regenerated from the packaged city.
  }
  return {};
}

function copyRuntimeBinary(sourcePath: string, targetPath: string): void {
  copyRuntimeFile(sourcePath, targetPath, { executable: true });
}

function copyRuntimeFile(
  sourcePath: string,
  targetPath: string,
  options: { readonly executable?: boolean } = {},
): void {
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  try {
    copyFileSync(sourcePath, tempPath);
    if (options.executable && process.platform !== "win32") {
      chmodSync(tempPath, 0o755);
    }
    renameSync(tempPath, targetPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function runGc(runtime: RuntimePaths, args: ReadonlyArray<string>): never {
  const gcApiUrl = resolveGcApiUrl(runtime);
  const env = {
    ...process.env,
    GC_HOME: runtime.rootDir,
    T3CODE_GASCITY_HOME: runtime.rootDir,
    GC_CITY_PATH: runtime.cityDir,
    GC_BEADS_BACKEND: "doltlite",
    BEADS_BACKEND: "doltlite",
    GC_BIN: runtime.gcBinaryPath,
    BD_BIN: runtime.bdBinaryPath,
    T3CODE_WORKTREES_DIR: runtime.worktreesDir,
    GC_WORKTREES_DIR: runtime.worktreesDir,
    GC_API_URL: gcApiUrl,
  };
  prepareRuntimeEnv(env, dirname(runtime.gcBinaryPath));
  const result = spawnSync(runtime.gcBinaryPath, ["--city", runtime.cityDir, ...args], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

function resolveGcApiUrl(runtime: RuntimePaths): string {
  const supervisorTomlPath = join(runtime.rootDir, "supervisor.toml");
  if (existsSync(supervisorTomlPath)) {
    const data = readFileSync(supervisorTomlPath, "utf8");
    const port = /^\s*port\s*=\s*(\d+)\s*$/m.exec(data)?.[1];
    if (port) {
      return `http://127.0.0.1:${port}`;
    }
  }
  return "http://127.0.0.1:8372";
}

function prepareRuntimeEnv(env: NodeJS.ProcessEnv, binDir: string): void {
  clearDoltServerEnv(env);
  prependPathEnv(env, "PATH", binDir);
  if (process.platform === "linux") {
    prependPathEnv(env, "LD_LIBRARY_PATH", binDir);
  } else if (process.platform === "darwin") {
    prependPathEnv(env, "DYLD_LIBRARY_PATH", binDir);
  }
}

function prependPathEnv(env: NodeJS.ProcessEnv, key: string, value: string): void {
  const actualKey =
    key === "PATH" && process.platform === "win32"
      ? (Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "Path")
      : key;
  const separator = process.platform === "win32" ? ";" : ":";
  env[actualKey] = [value, env[actualKey]].filter(Boolean).join(separator);
}

function clearDoltServerEnv(env: NodeJS.ProcessEnv): void {
  for (const key of [
    "BEADS_DOLT_AUTO_START",
    "BEADS_DOLT_DATABASE",
    "BEADS_DOLT_SHARED_SERVER",
    "BEADS_DOLT_PORT",
    "BEADS_DOLT_SERVER_DATABASE",
    "BEADS_DOLT_SERVER_HOST",
    "BEADS_DOLT_SERVER_MODE",
    "BEADS_DOLT_SERVER_PORT",
    "GC_DOLT_DATABASE",
    "GC_DOLT_HOST",
    "GC_DOLT_PASSWORD",
    "GC_DOLT_PORT",
    "GC_DOLT_USER",
  ]) {
    delete env[key];
  }
}

function printRuntime(runtime: RuntimePaths): void {
  console.log(`T3CODE_GASCITY_HOME=${runtime.rootDir}`);
  console.log(`GC_CITY_PATH=${runtime.cityDir}`);
  console.log(`GC_BIN=${runtime.gcBinaryPath}`);
  console.log(`BD_BIN=${runtime.bdBinaryPath}`);
  console.log(`DOLTLITE_LIBRARY=${runtime.doltliteLibraryPath}`);
  console.log(`T3CODE_WORKTREES_DIR=${runtime.worktreesDir}`);
  console.log(`GC_API_URL=${resolveGcApiUrl(runtime)}`);
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
