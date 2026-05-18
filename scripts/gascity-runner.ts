// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findBuiltBdBinaryPath, findBuiltDoltliteLibraryPath } from "@t3tools/beads-doltlite";
import { findBrBeadsProviderScriptPath, findBuiltGcBinaryPath } from "@t3tools/gascity";
import {
  getBundledGascityConfigLayout,
  resolveManagedBrBinaryPath,
  usesDoltliteBeadsBackend,
} from "@t3tools/gascity-config";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultT3Home = join(repoRoot, ".t3-dev");
const defaultRuntimeRoot = join(defaultT3Home, "gascity");
const defaultCityRoot = getBundledGascityConfigLayout("gascity-br").rootDir;
const configuredCitiesRoot = dirname(defaultCityRoot);
const command = process.argv[2] ?? "help";
const passthroughArgs = process.argv.slice(3);

interface RuntimePaths {
  readonly rootDir: string;
  readonly cityDir: string;
  readonly gcBinaryPath: string;
  readonly bdBinaryPath: string;
  readonly brBinaryPath: string;
  readonly brBeadsScriptPath: string;
  readonly doltliteLibraryPath: string;
  readonly worktreesDir: string;
}

const brBeadsScriptSourcePath = findBrBeadsProviderScriptPath();

async function main(): Promise<void> {
  switch (command) {
    case "install": {
      const runtime = installRuntime({
        overwriteConfig: shouldOverwriteInstallConfig(),
      });
      printRuntime(runtime);
      return;
    }
    case "prepare-update": {
      stopRuntimeSupervisorForUpdate(getRuntimePaths(), "updating Gas City tools");
      return;
    }
    case "dry-run": {
      const runtime = ensureRuntimeInstalled();
      const startArgs = await resolveCityCommandArgs("start", passthroughArgs, {
        prompt: false,
        showControllerStatus: false,
      });
      runGc(runtime, addStartFlag(startArgs, "--dry-run"));
      return;
    }
    case "gc": {
      const runtime = ensureRuntimeInstalled();
      runGc(runtime, passthroughArgs);
      return;
    }
    case "status": {
      const runtime = ensureRuntimeInstalled();
      const statusArgs = await resolveCityCommandArgs("status", passthroughArgs, {
        prompt: false,
        showControllerStatus: false,
      });
      runGc(runtime, statusArgs);
      return;
    }
    case "start": {
      const startArgs = await resolveCityCommandArgs("start", passthroughArgs, {
        prompt: true,
        showControllerStatus: false,
      });
      const runtime = ensureRuntimeInstalled();
      runStart(runtime, startArgs);
      return;
    }
    case "stop": {
      const runtime = getRuntimePaths();
      const stopArgs = await resolveCityCommandArgs("stop", passthroughArgs, {
        prompt: true,
        runtime,
        showControllerStatus: true,
      });
      runGc(runtime, stopArgs);
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function resolveCityCommandArgs(
  commandName: "start" | "status" | "stop",
  args: ReadonlyArray<string>,
  options: {
    readonly prompt: boolean;
    readonly runtime?: RuntimePaths;
    readonly showControllerStatus: boolean;
  },
): Promise<ReadonlyArray<string>> {
  const extracted = extractCitySelection(commandName, args);
  if (extracted.cityPath) {
    return ["--city", extracted.cityPath, commandName, ...extracted.args];
  }
  if (process.env.GC_CITY_PATH || process.env.GC_CITY) {
    return [commandName, ...extracted.args];
  }
  if (!options.prompt || !input.isTTY || !output.isTTY) {
    return [commandName, ...extracted.args];
  }
  const cityPath = await promptForCityPath({
    action: commandName,
    showControllerStatus: options.showControllerStatus,
    ...(options.runtime ? { runtime: options.runtime } : {}),
  });
  return ["--city", cityPath, commandName, ...extracted.args];
}

async function promptForCityPath(options: {
  readonly action: "start" | "status" | "stop";
  readonly runtime?: RuntimePaths;
  readonly showControllerStatus: boolean;
}): Promise<string> {
  const cities = configuredCityOptions();
  if (cities.length === 0) {
    throw new Error(`No configured cities found in ${configuredCitiesRoot}`);
  }
  const controllerStatuses =
    options.showControllerStatus && options.runtime
      ? readCityControllerStatuses(options.runtime, cities)
      : new Map<string, string>();
  if (cities.length === 1) {
    const [city] = cities;
    if (!city) {
      throw new Error(`No configured cities found in ${configuredCitiesRoot}`);
    }
    return city.path;
  }
  console.log(`Choose a Gas City city to ${options.action}:`);
  cities.forEach((city, index) => {
    const status = controllerStatuses.get(city.path);
    const suffix = status ? ` - ${status}` : "";
    console.log(`  ${index + 1}. ${city.name}${suffix} (${city.path})`);
  });
  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question(`City [1-${cities.length}]: `)).trim();
      const index = Number.parseInt(answer, 10);
      if (Number.isInteger(index) && index >= 1 && index <= cities.length) {
        const city = cities[index - 1];
        if (city) {
          return city.path;
        }
      }
      const byName = resolveConfiguredCityPath(answer);
      if (byName) {
        return byName;
      }
      console.error(`Enter a number from 1 to ${cities.length} or a configured city name.`);
    }
  } finally {
    rl.close();
  }
}

function extractCitySelection(
  commandName: "start" | "status" | "stop",
  args: ReadonlyArray<string>,
): { readonly cityPath: string | null; readonly args: ReadonlyArray<string> } {
  let cityPath: string | null = null;
  const remaining: string[] = [];
  let consumedPositionalCity = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--city") {
      const selector = args[index + 1];
      if (selector) {
        cityPath = resolveCitySelector(selector);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--city=")) {
      cityPath = resolveCitySelector(arg.slice("--city=".length));
      continue;
    }
    if (!consumedPositionalCity && !arg.startsWith("-")) {
      cityPath = resolveCitySelector(arg);
      consumedPositionalCity = true;
      continue;
    }
    remaining.push(arg);
  }
  if (cityPath && !existsSync(cityPath) && !resolveConfiguredCityPath(cityPath)) {
    throw new Error(`Unknown Gas City city for ${commandName}: ${cityPath}`);
  }
  return { cityPath, args: remaining };
}

function configuredCityOptions(): ReadonlyArray<{
  readonly name: string;
  readonly path: string;
}> {
  if (!existsSync(configuredCitiesRoot)) {
    return [];
  }
  return readdirSync(configuredCitiesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(configuredCitiesRoot, entry.name),
    }))
    .filter((city) => existsSync(join(city.path, "city.toml")))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function readCityControllerStatuses(
  runtime: RuntimePaths,
  cities: ReadonlyArray<{ readonly name: string; readonly path: string }>,
): Map<string, string> {
  const result = spawnSync(runtime.gcBinaryPath, ["cities"], {
    cwd: repoRoot,
    env: runtimeEnv(runtime),
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.error || (result.status ?? 1) !== 0) {
    return new Map(cities.map((city) => [city.path, "status unavailable"]));
  }
  const outputText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return new Map(
    cities.map((city) => {
      const line =
        outputText
          .split("\n")
          .find((candidate) => candidate.includes(city.path) || candidate.includes(city.name)) ??
        "";
      if (!line) {
        return [city.path, "not registered"] as const;
      }
      return [city.path, summarizeControllerStatus(line)] as const;
    }),
  );
}

function summarizeControllerStatus(line: string): string {
  if (/\b(running|active|started|up)\b/i.test(line)) {
    return "running";
  }
  if (/\b(stopped|inactive|down|dead|failed)\b/i.test(line)) {
    return "stopped";
  }
  if (/\b(suspended)\b/i.test(line)) {
    return "suspended";
  }
  return "registered";
}

function resolveConfiguredCityPath(selector: string | undefined): string | null {
  if (!selector) {
    return null;
  }
  const match = configuredCityOptions().find((city) => city.name === selector);
  return match?.path ?? null;
}

function resolveCitySelector(selector: string): string {
  return resolveConfiguredCityPath(selector) ?? selector;
}

function normalizeCityArgs(args: ReadonlyArray<string>): ReadonlyArray<string> {
  const normalized = [...args];
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg === "--city" && normalized[index + 1]) {
      const cityArg = normalized[index + 1];
      if (cityArg) {
        normalized[index + 1] = resolveCitySelector(cityArg);
      }
      index += 1;
      continue;
    }
    if (arg?.startsWith("--city=")) {
      normalized[index] = `--city=${resolveCitySelector(arg.slice("--city=".length))}`;
      continue;
    }
  }
  const commandName = normalized[0];
  if (commandName !== "start" && commandName !== "register") {
    return normalized;
  }
  for (let index = 1; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (!arg) continue;
    if (arg.startsWith("-")) {
      if (arg === "--name" || arg === "--rig" || arg === "--city") {
        index += 1;
      }
      continue;
    }
    normalized[index] = resolveCitySelector(arg);
    return normalized;
  }
  return normalized;
}

function addStartFlag(args: ReadonlyArray<string>, flag: string): string[] {
  const next = [...args];
  const startIndex = next.indexOf("start");
  if (startIndex === -1) {
    return ["start", flag, ...next];
  }
  if (!next.includes(flag)) {
    next.splice(startIndex + 1, 0, flag);
  }
  return next;
}

function installRuntime(options: { readonly overwriteConfig: boolean }): RuntimePaths {
  if (options.overwriteConfig) {
    console.warn(
      "gascity:install no longer overwrites config; packages/gascity-config/config is the active city.",
    );
  }
  const rootDir = process.env.T3CODE_GASCITY_HOME ?? process.env.GC_HOME ?? defaultRuntimeRoot;
  const gcBinarySource = process.env.GASCITY_BINARY ?? findBuiltGcBinaryPath();
  const bdBinarySource = process.env.BD_BINARY ?? findBuiltBdBinaryPath();
  const doltliteLibrarySource = process.env.DOLTLITE_LIBRARY ?? findBuiltDoltliteLibraryPath();
  if (!gcBinarySource) {
    throw new Error("No built Gas City binary is available. Run bun build:gascity-tools.");
  }
  if (!bdBinarySource) {
    throw new Error("No built beads binary is available. Run bun build:gascity-tools.");
  }
  if (!brBeadsScriptSourcePath) {
    throw new Error("No beads_rust exec provider script is available in @t3tools/gascity.");
  }
  if (!doltliteLibrarySource && process.platform !== "win32") {
    throw new Error("No built Doltlite runtime library is available. Run bun build:gascity-tools.");
  }
  const brBinarySource = resolveManagedBrBinaryPath();
  const runtime = getRuntimePaths();
  stopRuntimeSupervisorForUpdate(runtime, "installing Gas City tools");
  mkdirSync(dirname(runtime.gcBinaryPath), { recursive: true });
  copyRuntimeBinary(gcBinarySource, runtime.gcBinaryPath);
  copyRuntimeBinary(bdBinarySource, runtime.bdBinaryPath);
  copyRuntimeBinary(brBinarySource, runtime.brBinaryPath);
  copyRuntimeBinary(brBeadsScriptSourcePath, runtime.brBeadsScriptPath);
  if (doltliteLibrarySource) {
    copyRuntimeFile(doltliteLibrarySource, runtime.doltliteLibraryPath);
  }
  ensureRuntimeCommandLinks(runtime);
  ensureRuntimeDoltliteLibraryLinks(runtime);
  prepareActiveCity(defaultCityRoot, {
    bdBinaryPath: runtime.bdBinaryPath,
    initializeStores: false,
  });
  if (resolve(runtime.cityDir) !== resolve(defaultCityRoot)) {
    prepareActiveCity(runtime.cityDir, {
      bdBinaryPath: runtime.bdBinaryPath,
      initializeStores: false,
    });
  }
  ensureBundledCitySiteBindings();
  return {
    rootDir,
    cityDir: runtime.cityDir,
    gcBinaryPath: runtime.gcBinaryPath,
    bdBinaryPath: runtime.bdBinaryPath,
    brBinaryPath: runtime.brBinaryPath,
    brBeadsScriptPath: runtime.brBeadsScriptPath,
    doltliteLibraryPath: runtime.doltliteLibraryPath,
    worktreesDir: runtime.worktreesDir,
  };
}

function ensureRuntimeInstalled(): RuntimePaths {
  const runtime = getRuntimePaths();
  const gcBinarySource = process.env.GASCITY_BINARY ?? findBuiltGcBinaryPath();
  const bdBinarySource = process.env.BD_BINARY ?? findBuiltBdBinaryPath();
  const doltliteLibrarySource = process.env.DOLTLITE_LIBRARY ?? findBuiltDoltliteLibraryPath();
  const canResolveBr =
    gcBinarySource !== undefined &&
    bdBinarySource !== undefined &&
    (doltliteLibrarySource !== undefined || process.platform === "win32");
  const brBinarySource = canResolveBr ? resolveManagedBrBinaryPath() : undefined;
  if (
    runtimeMatchesSources(runtime, {
      gcBinarySource,
      bdBinarySource,
      brBinarySource,
      doltliteLibrarySource,
    })
  ) {
    ensureRuntimeCommandLinks(runtime);
    ensureRuntimeDoltliteLibraryLinks(runtime);
    prepareActiveCity(runtime.cityDir, { initializeStores: false });
    ensureBundledCitySiteBindings();
    return runtime;
  }
  return installRuntime({ overwriteConfig: false });
}

function runtimeMatchesSources(
  runtime: RuntimePaths,
  sources: {
    readonly gcBinarySource: string | undefined;
    readonly bdBinarySource: string | undefined;
    readonly brBinarySource: string | undefined;
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
  if (!sources.brBinarySource || !sameFileHash(sources.brBinarySource, runtime.brBinaryPath)) {
    return false;
  }
  if (
    !brBeadsScriptSourcePath ||
    !sameFileHash(brBeadsScriptSourcePath, runtime.brBeadsScriptPath)
  ) {
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

function stopRuntimeSupervisorForUpdate(runtime: RuntimePaths, action: string): void {
  if (!existsSync(runtime.gcBinaryPath)) {
    return;
  }
  const result = spawnSync(
    runtime.gcBinaryPath,
    ["supervisor", "stop", "--wait", "--wait-timeout", "45s"],
    {
      cwd: repoRoot,
      env: runtimeEnv(runtime),
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  const outputText = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if ((result.status ?? 1) === 0) {
    const output = outputText.trim();
    if (output) {
      console.log(output);
    }
    terminateOrphanedRuntimeSupervisors(runtime);
    return;
  }
  if (/\bsupervisor is not running\b/i.test(outputText)) {
    terminateOrphanedRuntimeSupervisors(runtime);
    return;
  }
  if (terminateOrphanedRuntimeSupervisors(runtime) > 0) {
    return;
  }
  if (outputText.trim()) {
    process.stderr.write(outputText);
  }
  const reason = result.error instanceof Error ? `: ${result.error.message}` : "";
  throw new Error(`Failed to stop Gas City supervisor before ${action}${reason}`);
}

function terminateOrphanedRuntimeSupervisors(runtime: RuntimePaths): number {
  if (process.platform === "win32" || !existsSync("/proc")) {
    return 0;
  }
  const pids = readdirSync("/proc")
    .map((entry) => Number(entry))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
    .filter((pid) => processMatchesRuntimeSupervisor(pid, runtime.gcBinaryPath));
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may already have exited between scan and signal.
    }
  }
  waitForProcessesToExit(pids, 2000);
  for (const pid of pids.filter((pid) => existsSync(`/proc/${pid}`))) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may already have exited between scan and signal.
    }
  }
  if (pids.length > 0) {
    console.log(`Stopped ${pids.length} stale Gas City supervisor process(es).`);
  }
  return pids.length;
}

function processMatchesRuntimeSupervisor(pid: number, gcBinaryPath: string): boolean {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    if (!cmdline.includes(" supervisor run")) {
      return false;
    }
    const exePath = readlinkSync(`/proc/${pid}/exe`);
    return exePath === gcBinaryPath || exePath === `${gcBinaryPath} (deleted)`;
  } catch {
    return false;
  }
}

function waitForProcessesToExit(pids: ReadonlyArray<number>, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pids.some((pid) => existsSync(`/proc/${pid}`))) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

function getRuntimePaths(): RuntimePaths {
  const rootDir = process.env.T3CODE_GASCITY_HOME ?? process.env.GC_HOME ?? defaultRuntimeRoot;
  const configuredCity = process.env.GC_CITY_PATH ?? process.env.GC_CITY;
  return {
    rootDir,
    cityDir: configuredCity ? resolveCitySelector(configuredCity) : defaultCityRoot,
    gcBinaryPath: join(rootDir, "bin", process.platform === "win32" ? "gc.exe" : "gc"),
    bdBinaryPath: join(rootDir, "bin", process.platform === "win32" ? "bd.exe" : "bd"),
    brBinaryPath: join(rootDir, "bin", process.platform === "win32" ? "br.exe" : "br"),
    brBeadsScriptPath: join(
      rootDir,
      "bin",
      process.platform === "win32" ? "gc-beads-br.cmd" : "gc-beads-br",
    ),
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
      join(process.env.T3CODE_HOME?.trim() || defaultT3Home, "worktrees"),
  };
}

function ensureBundledCitySiteBindings(): void {
  for (const city of configuredCityOptions()) {
    prepareActiveCity(city.path, {
      initializeStores: false,
    });
    writeBundledCitySiteBinding(city.path);
  }
}

function writeBundledCitySiteBinding(cityPath: string): void {
  const rigNames = readCityRigNames(cityPath);
  const rigEntries = rigNames
    .map((name) => ({ name, path: bundledRigPath(cityPath, name) }))
    .filter(
      (entry): entry is { readonly name: string; readonly path: string } => entry.path !== null,
    );
  const siteDir = join(cityPath, ".gc");
  mkdirSync(siteDir, { recursive: true });
  const workspaceName = registrationNameForCity(cityPath);
  const workspacePrefix = readWorkspacePrefix(cityPath) ?? defaultWorkspacePrefix(cityPath);
  const header = [
    `workspace_name = ${JSON.stringify(workspaceName)}`,
    ...(workspacePrefix ? [`workspace_prefix = ${JSON.stringify(workspacePrefix)}`] : []),
  ];
  const rigBlocks = rigEntries.map(
    (entry) =>
      `[[rig]]\nname = ${JSON.stringify(entry.name)}\npath = ${JSON.stringify(entry.path)}`,
  );
  writeFileSync(join(siteDir, "site.toml"), `${[...header, ...rigBlocks].join("\n\n")}\n`);
}

function readCityRigNames(cityPath: string): string[] {
  const content = readFileSync(join(cityPath, "city.toml"), "utf8");
  const names: string[] = [];
  for (const match of content.matchAll(/(?:^|\n)\[\[rigs\]\]([\s\S]*?)(?=\n\[\[|\n\[|$)/g)) {
    const name = /^\s*name\s*=\s*"([^"]+)"\s*$/m.exec(match[1] ?? "")?.[1];
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function bundledRigPath(cityPath: string, rigName: string): string | null {
  const cityName = basename(resolve(cityPath));
  const known: Record<string, Record<string, string>> = {
    "gascity-br": {
      "agentic-flow": join(cityPath, "rigs", "agentic-flow"),
      beads_rust: join(cityPath, "rigs", "beads_rust"),
      "t3-jj": join(cityPath, "rigs", "t3code"),
    },
    gastown: {
      "beads-doltlite": join(repoRoot, "packages", "beads-doltlite"),
      gascity: join(repoRoot, "packages", "gascity"),
      t3code: repoRoot,
      "test-rig": join(cityPath, "rigs", "test-rig"),
    },
  };
  const mapped = known[cityName]?.[rigName];
  if (mapped) {
    return mapped;
  }
  const cityRig = join(cityPath, "rigs", rigName);
  if (existsSync(cityRig)) {
    return cityRig;
  }
  const packageRig = join(repoRoot, "packages", rigName);
  if (existsSync(packageRig)) {
    return packageRig;
  }
  return null;
}

function readWorkspacePrefix(cityPath: string): string | null {
  const content = readFileSync(join(cityPath, "city.toml"), "utf8");
  const workspaceMatch = /(?:^|\n)\[workspace\]([\s\S]*?)(?:\n\[|$)/.exec(content);
  return /^\s*prefix\s*=\s*"([^"]+)"\s*$/m.exec(workspaceMatch?.[1] ?? "")?.[1] ?? null;
}

function defaultWorkspacePrefix(cityPath: string): string | null {
  return basename(resolve(cityPath)) === "gascity-br" ? "gh" : null;
}

function prepareActiveCity(
  cityDir: string,
  options: {
    readonly bdBinaryPath?: string;
    readonly initializeStores: boolean;
  },
): void {
  if (usesDoltliteBeadsBackend(cityDir)) {
    writeDefaultBeadsConfig(cityDir, "t3", "hq");
    if (options.initializeStores) {
      if (!options.bdBinaryPath)
        throw new Error("bd binary path is required to initialize beads stores");
      initializeDoltliteBeadsStore(options.bdBinaryPath, cityDir, "t3");
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

function ensureRuntimeCommandLinks(runtime: RuntimePaths): void {
  if (process.platform === "win32") return;
  const linkTargets = [
    { command: "gc", target: runtime.gcBinaryPath },
    { command: "bd", target: runtime.bdBinaryPath },
    { command: "br", target: runtime.brBinaryPath },
    { command: "gc-beads-br", target: runtime.brBeadsScriptPath },
  ] as const;
  const userBinDirs = [join(homedir(), "go", "bin"), join(homedir(), ".local", "bin")];
  for (const binDir of userBinDirs) {
    mkdirSync(binDir, { recursive: true });
    for (const { command, target } of linkTargets) {
      ensureRuntimeCommandLink(join(binDir, command), target);
    }
  }
}

function ensureRuntimeDoltliteLibraryLinks(runtime: RuntimePaths): void {
  if (process.platform !== "linux") return;
  ensureRuntimeCommandLink(
    join(dirname(runtime.doltliteLibraryPath), "libdoltlite.so.0"),
    runtime.doltliteLibraryPath,
  );
}

function ensureRuntimeCommandLink(linkPath: string, targetPath: string): void {
  if (existsSync(linkPath)) {
    try {
      if (readlinkSync(linkPath) === targetPath) {
        return;
      }
      rmSync(linkPath, { force: true });
    } catch {
      const backupPath = `${linkPath}.pre-t3code-${new Date().toISOString().replaceAll(/[:.]/g, "")}`;
      renameSync(linkPath, backupPath);
    }
  }
  symlinkSync(targetPath, linkPath);
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
  const selectedCityPath = selectedCityPathForEnv(runtime, args);
  if (selectedCityPath && existsSync(selectedCityPath)) {
    prepareActiveCity(selectedCityPath, { initializeStores: false });
  }
  const env: NodeJS.ProcessEnv = runtimeEnv(runtime, gcApiUrl);
  if (selectedCityPath) {
    env.GC_CITY_PATH = selectedCityPath;
    env.GC_CITY = selectedCityPath;
  }
  const result = spawnSync(
    runtime.gcBinaryPath,
    gcArgsForRuntime(runtime, normalizeCityArgs(args)),
    {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

function runStart(runtime: RuntimePaths, args: ReadonlyArray<string>): never {
  const normalizedArgs = normalizeCityArgs(args);
  const selectedCityPath = selectedCityPathForEnv(runtime, normalizedArgs);
  if (!selectedCityPath || !cityWorkspaceIsSuspended(selectedCityPath)) {
    runGc(runtime, normalizedArgs);
  }

  prepareActiveCity(selectedCityPath, { initializeStores: false });
  const env = runtimeEnv(runtime, resolveGcApiUrl(runtime));
  env.GC_CITY_PATH = selectedCityPath;
  env.GC_CITY = selectedCityPath;

  const supervisorStart = spawnSync(runtime.gcBinaryPath, ["supervisor", "start"], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  const supervisorStartOutput = `${supervisorStart.stdout ?? ""}${supervisorStart.stderr ?? ""}`;
  if (
    (supervisorStart.status ?? 1) !== 0 &&
    !supervisorStartOutput.includes("supervisor already running")
  ) {
    process.stdout.write(supervisorStart.stdout ?? "");
    process.stderr.write(supervisorStart.stderr ?? "");
    process.exit(supervisorStart.status ?? 1);
  }
  process.stdout.write(supervisorStart.stdout ?? "");
  process.stderr.write(supervisorStart.stderr ?? "");

  upsertRuntimeCityRegistration(runtime, selectedCityPath);

  const supervisorReload = spawnSync(runtime.gcBinaryPath, ["supervisor", "reload"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if ((supervisorReload.status ?? 1) !== 0) {
    process.exit(supervisorReload.status ?? 1);
  }

  console.log(
    `Registered suspended city '${registrationNameForCity(selectedCityPath)}' (${selectedCityPath})`,
  );
  console.log("Gas City supervisor API is ready; agents remain suspended by city config.");
  process.exit(0);
}

function runtimeEnv(runtime: RuntimePaths, gcApiUrl = resolveGcApiUrl(runtime)): NodeJS.ProcessEnv {
  const t3WsUrl = resolveT3WsUrl();
  const t3Home = process.env.T3_HOME?.trim() || process.env.T3CODE_HOME?.trim() || defaultT3Home;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    T3_HOME: t3Home,
    T3CODE_HOME: t3Home,
    GC_HOME: runtime.rootDir,
    T3CODE_GASCITY_HOME: runtime.rootDir,
    GC_BIN: runtime.gcBinaryPath,
    BD_BIN: runtime.bdBinaryPath,
    BR_BIN: runtime.brBinaryPath,
    T3CODE_WORKTREES_DIR: runtime.worktreesDir,
    GC_WORKTREES_DIR: runtime.worktreesDir,
    GC_API_URL: gcApiUrl,
    ...(t3WsUrl ? { T3_WS_URL: t3WsUrl } : {}),
  };
  prepareRuntimeEnv(env, dirname(runtime.gcBinaryPath));
  return env;
}

function resolveT3WsUrl(): string | null {
  const explicit = process.env.T3_WS_URL?.trim() || process.env.VITE_WS_URL?.trim();
  if (explicit) {
    return explicit.endsWith("/ws") ? explicit : `${explicit.replace(/\/$/, "")}/ws`;
  }
  const port = process.env.T3CODE_PORT?.trim() || "13773";
  return `ws://127.0.0.1:${port}/ws`;
}

function cityWorkspaceIsSuspended(cityPath: string): boolean {
  const cityTomlPath = join(cityPath, "city.toml");
  if (!existsSync(cityTomlPath)) {
    return false;
  }
  const content = readFileSync(cityTomlPath, "utf8");
  const workspaceMatch = /(?:^|\n)\[workspace\]([\s\S]*?)(?:\n\[|$)/.exec(content);
  const workspaceBody = workspaceMatch?.[1] ?? "";
  return /^\s*suspended\s*=\s*true\s*$/m.test(workspaceBody);
}

function registrationNameForCity(cityPath: string): string {
  const cityTomlPath = join(cityPath, "city.toml");
  if (existsSync(cityTomlPath)) {
    const content = readFileSync(cityTomlPath, "utf8");
    const workspaceMatch = /(?:^|\n)\[workspace\]([\s\S]*?)(?:\n\[|$)/.exec(content);
    const explicitName = /^\s*name\s*=\s*"([^"]+)"\s*$/m.exec(workspaceMatch?.[1] ?? "")?.[1];
    if (explicitName) {
      return explicitName;
    }
  }
  return basename(resolve(cityPath));
}

function upsertRuntimeCityRegistration(runtime: RuntimePaths, cityPath: string): void {
  mkdirSync(runtime.rootDir, { recursive: true });
  const registryPath = join(runtime.rootDir, "cities.toml");
  const name = registrationNameForCity(cityPath);
  const entries = readRuntimeCityRegistrations(registryPath).filter(
    (entry) => entry.path !== cityPath && entry.name !== name,
  );
  entries.push({ name, path: cityPath });
  writeFileSync(
    registryPath,
    `${entries
      .map(
        (entry) =>
          `[[cities]]\n  path = ${JSON.stringify(entry.path)}\n  name = ${JSON.stringify(entry.name)}`,
      )
      .join("\n\n")}\n`,
  );
}

function readRuntimeCityRegistrations(
  registryPath: string,
): ReadonlyArray<{ readonly name: string; readonly path: string }> {
  if (!existsSync(registryPath)) {
    return [];
  }
  const content = readFileSync(registryPath, "utf8");
  return content
    .split(/\n(?=\[\[cities\]\])/)
    .map((block) => {
      const path = /^\s*path\s*=\s*"([^"]+)"\s*$/m.exec(block)?.[1];
      const name = /^\s*name\s*=\s*"([^"]+)"\s*$/m.exec(block)?.[1];
      return path && name ? { name, path } : null;
    })
    .filter((entry): entry is { readonly name: string; readonly path: string } => entry !== null);
}

function gcArgsForRuntime(runtime: RuntimePaths, args: ReadonlyArray<string>): string[] {
  if (argsSelectCity(args)) {
    return [...args];
  }
  return ["--city", runtime.cityDir, ...args];
}

function selectedCityPathForEnv(runtime: RuntimePaths, args: ReadonlyArray<string>): string | null {
  const command = args[0];
  if (command === "cities" || command === "supervisor") {
    return selectedCityPathFromArgs(args);
  }
  return selectedCityPathFromArgs(args) ?? runtime.cityDir;
}

function argsSelectCity(args: ReadonlyArray<string>): boolean {
  if (selectedCityPathFromArgs(args)) {
    return true;
  }
  const command = args[0];
  if (!command) {
    return false;
  }
  if (command === "start" || command === "register") {
    const target = args[1];
    return typeof target === "string" && target.length > 0 && !target.startsWith("-");
  }
  return command === "cities" || command === "supervisor";
}

function selectedCityPathFromArgs(args: ReadonlyArray<string>): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--city") {
      const selector = args[index + 1];
      return selector ? resolveCitySelector(selector) : null;
    }
    if (arg?.startsWith("--city=")) {
      return resolveCitySelector(arg.slice("--city=".length));
    }
  }
  const command = args[0];
  if (command !== "start" && command !== "register") {
    return null;
  }
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg.startsWith("-")) {
      if (arg === "--name" || arg === "--rig") {
        index += 1;
      }
      continue;
    }
    return resolveCitySelector(arg);
  }
  return null;
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
  console.log(`BR_BIN=${runtime.brBinaryPath}`);
  console.log(`GC_BEADS_BR=${runtime.brBeadsScriptPath}`);
  console.log(`DOLTLITE_LIBRARY=${runtime.doltliteLibraryPath}`);
  console.log(`T3CODE_WORKTREES_DIR=${runtime.worktreesDir}`);
  console.log(`GC_API_URL=${resolveGcApiUrl(runtime)}`);
}

function printHelp(): void {
  console.log(`Usage: bun gascity:<command>

Commands:
  bun gascity:install   Install built GC, bd, and br binaries; use repo packaged city
  bun gascity:prepare-update
                         Stop bundled supervisor before rebuilding or reinstalling tools
  bun gascity:dry-run   Show agents GC would start without side effects
  bun gascity:status    Show bundled city status
  bun gascity:start     Choose and start a configured city in an interactive terminal
  bun gascity:stop      Stop GC sessions for the bundled runtime
  bun gascity:config    Show resolved GC config
  bun gascity:path      Print runtime paths
  bun gc -- <args>      Run bundled gc with the packaged city

Env:
  T3CODE_GASCITY_HOME   Override runtime dir
  T3CODE_WORKTREES_DIR  Override shared T3Code/Gas City worktree root
  GC_CITY_PATH          Override active city dir or configured city name
  GC_CITY               Override active city dir or configured city name
  GASCITY_BINARY        Override built gc binary
  BD_BINARY             Override built bd binary
  BR_BINARY             Override managed beads_rust br binary

City selection:
  bun gascity:start                 Prompt for a city when stdin/stdout are TTYs
  bun gascity:stop                  Prompt for a city and show controller status in a TTY
  bun gascity:start gascity-br      Start a configured city by name
  bun gascity:stop gascity-br       Stop a configured city by name
  bun gascity:start /path/to/city   Start a configured city by path
  bun gascity:start --city gastown  Start a configured city by name with --city

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
