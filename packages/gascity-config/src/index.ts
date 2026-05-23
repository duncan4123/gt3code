// @effect-diagnostics nodeBuiltinImport:off
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const GASCITY_CONFIG_PACKAGE_NAME = "@t3tools/gascity-config";
export const BUNDLED_GASCITY_CITY_NAMES = ["gastown", "gascity-br"] as const;
export type BundledGascityCityName = (typeof BUNDLED_GASCITY_CITY_NAMES)[number];

export interface GascityConfigLayout {
  readonly rootDir: string;
  readonly cityTomlPath: string;
  readonly packTomlPath: string;
  readonly packsDir: string;
  readonly gastownPackDir: string;
  readonly doltliteGastownPackDir: string;
  readonly maintenancePackDir: string;
}

export interface GascityBeadsConfig {
  readonly provider: string;
  readonly backend: string | null;
}

export interface MaterializeGascityConfigOptions {
  readonly targetDir: string;
  readonly overwrite?: boolean;
}

export interface GascityBinaryTarget {
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
}

export interface MaterializeGascityRuntimeOptions extends GascityBinaryTarget {
  readonly targetDir: string;
  readonly overwriteConfig?: boolean;
  readonly preserveExistingConfig?: boolean;
  readonly gcBinaryPath?: string;
  readonly bdBinaryPath?: string;
  readonly brBinaryPath?: string;
  readonly doltliteLibraryPath?: string;
  readonly seedLocalBeadsConfig?: boolean;
}

type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

export interface GascityRuntimeLayout {
  readonly rootDir: string;
  readonly city: GascityConfigLayout;
  readonly binDir: string;
  readonly gcBinaryPath: string;
  readonly bdBinaryPath: string;
  readonly brBinaryPath: string;
  readonly doltliteLibraryPath: string;
}

const modulePackageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function hasBundledGascityConfigRoot(candidateRoot: string): boolean {
  return (
    existsSync(path.join(candidateRoot, "config", "cities", "gastown", "city.toml")) &&
    existsSync(path.join(candidateRoot, "config", "cities", "gastown", "pack.toml")) &&
    existsSync(path.join(candidateRoot, "config", "cities", "gascity-br", "city.toml")) &&
    existsSync(path.join(candidateRoot, "config", "cities", "gascity-br", "pack.toml")) &&
    existsSync(path.join(candidateRoot, "config", "packs", "gastown", "pack.toml")) &&
    existsSync(path.join(candidateRoot, "config", "packs", "doltlite-gastown", "pack.toml"))
  );
}

function findRepoPackageRootFrom(startPath: string): string | undefined {
  let current = path.resolve(startPath);
  while (true) {
    const candidate = path.join(current, "packages", "gascity-config");
    if (hasBundledGascityConfigRoot(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function resolvePackageRoot(): string {
  const configured = process.env.T3CODE_GASCITY_CONFIG_ROOT?.trim();
  if (configured && hasBundledGascityConfigRoot(configured)) {
    return path.resolve(configured);
  }

  const candidates = [
    modulePackageRoot,
    path.resolve(process.cwd(), "packages", "gascity-config"),
    findRepoPackageRootFrom(process.cwd()),
    findRepoPackageRootFrom(modulePackageRoot),
  ];
  for (const candidate of candidates) {
    if (candidate && hasBundledGascityConfigRoot(candidate)) {
      return candidate;
    }
  }

  return modulePackageRoot;
}

const packageRoot = resolvePackageRoot();
const configBundleRoot = path.join(packageRoot, "config");
const configRoot = path.join(configBundleRoot, "cities", "gastown");
const binariesRoot = path.join(packageRoot, "binaries");

export function getBundledGascityConfigLayout(
  cityName: BundledGascityCityName = "gastown",
): GascityConfigLayout {
  return getGascityConfigLayout(
    path.join(configBundleRoot, "cities", cityName),
    path.join(configBundleRoot, "packs"),
  );
}

export function getBundledGascityConfigLayouts(): ReadonlyArray<GascityConfigLayout> {
  return BUNDLED_GASCITY_CITY_NAMES.map((cityName) => getBundledGascityConfigLayout(cityName));
}

export function isBundledGascityCityRoot(cityPath: string): boolean {
  const resolved = path.resolve(cityPath);
  return getBundledGascityConfigLayouts().some(
    (layout) => path.resolve(layout.rootDir) === resolved,
  );
}

function getGascityConfigLayout(rootDir: string, packsRoot?: string): GascityConfigLayout {
  const packsDir = packsRoot ? path.resolve(packsRoot) : path.resolve(rootDir, "..", "packs");
  return {
    rootDir,
    cityTomlPath: path.join(rootDir, "city.toml"),
    packTomlPath: path.join(rootDir, "pack.toml"),
    packsDir,
    gastownPackDir: path.join(packsDir, "gastown"),
    doltliteGastownPackDir: path.join(packsDir, "doltlite-gastown"),
    maintenancePackDir: path.join(packsDir, "maintenance"),
  };
}

function readTomlSectionValue(content: string, sectionName: string, key: string): string | null {
  const lines = content.split("\n");
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      inSection = trimmed === `[${sectionName}]`;
      continue;
    }
    if (!inSection || !trimmed.startsWith(`${key} =`)) continue;
    const rawValue = trimmed.slice(trimmed.indexOf("=") + 1).trim();
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      return rawValue.slice(1, -1);
    }
    return rawValue;
  }
  return null;
}

export function readGascityBeadsConfig(cityDir: string): GascityBeadsConfig {
  const cityTomlPath = path.join(cityDir, "city.toml");
  if (!existsSync(cityTomlPath)) {
    return { provider: "bd", backend: null };
  }
  const content = readFileSync(cityTomlPath, "utf8");
  return {
    provider: readTomlSectionValue(content, "beads", "provider") ?? "bd",
    backend: readTomlSectionValue(content, "beads", "backend"),
  };
}

export function usesDoltliteBeadsBackend(cityDir: string): boolean {
  const beads = readGascityBeadsConfig(cityDir);
  return beads.provider === "bd" && beads.backend === "doltlite";
}

export function materializeGascityConfig(
  options: MaterializeGascityConfigOptions,
): GascityConfigLayout {
  const targetDir = path.resolve(options.targetDir);
  if (existsSync(targetDir) && !options.overwrite && readdirSync(targetDir).length > 0) {
    throw new Error(`Refusing to overwrite non-empty Gas City config directory: ${targetDir}`);
  }

  mkdirSync(targetDir, { recursive: true });
  cpSync(configRoot, targetDir, {
    recursive: true,
    force: options.overwrite ?? false,
    filter: shouldCopyConfigPath,
  });
  for (const fileName of ["city.toml", "pack.toml"]) {
    const filePath = path.join(targetDir, fileName);
    if (existsSync(filePath)) {
      writeFileSync(
        filePath,
        readFileSync(filePath, "utf8").replaceAll("../../packs/", "../packs/"),
        "utf8",
      );
    }
  }
  cpSync(path.join(configBundleRoot, "packs"), path.resolve(targetDir, "..", "packs"), {
    recursive: true,
    force: options.overwrite ?? false,
    filter: shouldCopyConfigPath,
  });

  return getGascityConfigLayout(targetDir);
}

export function getBundledGcBinaryPath(target: GascityBinaryTarget = {}): string {
  return getBundledBinaryPath("gc", target);
}

export function getBundledBdBinaryPath(target: GascityBinaryTarget = {}): string {
  return getBundledBinaryPath("bd", target);
}

export function getBrExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "br.exe" : "br";
}

export function getBundledBeadsRustRigPath(): string {
  return path.join(getBundledGascityConfigLayout("gascity-br").rootDir, "rigs", "beads_rust");
}

export function getBuiltBrBinaryPath(target: GascityBinaryTarget = {}): string {
  return path.join(
    getBundledBeadsRustRigPath(),
    "target",
    "release",
    getBrExecutableName(target.platform),
  );
}

export function findBuiltBrBinaryPath(target: GascityBinaryTarget = {}): string | undefined {
  const binaryPath = getBuiltBrBinaryPath(target);
  return existsSync(binaryPath) && statSync(binaryPath).isFile() ? binaryPath : undefined;
}

export function resolveManagedBrBinaryPath(
  options: GascityBinaryTarget & { readonly brBinaryPath?: string } = {},
): string {
  const override = options.brBinaryPath?.trim() || process.env.BR_BINARY?.trim();
  if (override) {
    return path.resolve(override);
  }
  return ensureBuiltBrBinaryPath(options);
}

export function ensureBuiltBrBinaryPath(target: GascityBinaryTarget = {}): string {
  const rigPath = getBundledBeadsRustRigPath();
  const binaryPath = getBuiltBrBinaryPath(target);
  if (isBuiltBrBinaryFresh(rigPath, binaryPath)) {
    return binaryPath;
  }
  const manifestPath = path.join(rigPath, "Cargo.toml");
  if (!existsSync(manifestPath)) {
    throw new Error(`Bundled beads_rust rig is missing Cargo.toml at ${manifestPath}.`);
  }
  const result = spawnSync(
    "cargo",
    [
      "build",
      "--release",
      "--manifest-path",
      manifestPath,
      "--target-dir",
      path.join(rigPath, "target"),
    ],
    {
      cwd: rigPath,
      encoding: "utf8",
      env: {
        ...process.env,
        CARGO_TERM_COLOR: "never",
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error(`Failed to build bundled beads_rust br binary: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `Failed to build bundled beads_rust br binary:\n${tailProcessOutput(
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      )}`,
    );
  }
  if (!existsSync(binaryPath) || !statSync(binaryPath).isFile()) {
    throw new Error(`Bundled beads_rust build finished but did not produce ${binaryPath}.`);
  }
  return binaryPath;
}

export function getBundledDoltliteLibraryPath(target: GascityBinaryTarget = {}): string {
  const platform = target.platform ?? process.platform;
  const arch = target.arch ?? process.arch;
  const library =
    platform === "darwin"
      ? "libdoltlite.dylib"
      : platform === "win32"
        ? "doltlite.dll"
        : "libdoltlite.so";
  return path.join(binariesRoot, `${platform}-${arch}`, library);
}

function getBundledBinaryPath(name: "bd" | "gc", target: GascityBinaryTarget = {}): string {
  const platform = target.platform ?? process.platform;
  const arch = target.arch ?? process.arch;
  const executable = platform === "win32" ? `${name}.exe` : name;
  return path.join(binariesRoot, `${platform}-${arch}`, executable);
}

export function findBundledGcBinaryPath(target: GascityBinaryTarget = {}): string | undefined {
  const binaryPath = getBundledGcBinaryPath(target);
  return existsSync(binaryPath) && statSync(binaryPath).isFile() ? binaryPath : undefined;
}

export function findBundledBdBinaryPath(target: GascityBinaryTarget = {}): string | undefined {
  const binaryPath = getBundledBdBinaryPath(target);
  return existsSync(binaryPath) && statSync(binaryPath).isFile() ? binaryPath : undefined;
}

export function findBundledDoltliteLibraryPath(
  target: GascityBinaryTarget = {},
): string | undefined {
  const libraryPath = getBundledDoltliteLibraryPath(target);
  return existsSync(libraryPath) && statSync(libraryPath).isFile() ? libraryPath : undefined;
}

export function getDefaultGascityRuntimeRoot(
  target: { readonly platform?: NodeJS.Platform; readonly env?: NodeJS.ProcessEnv } = {},
): string {
  const platform = target.platform ?? process.platform;
  const env = target.env ?? process.env;
  if (platform === "win32") {
    return path.join(
      env.LOCALAPPDATA?.trim() || path.join(homedir(), "AppData", "Local"),
      "T3Code",
      "GasCity",
      "current",
    );
  }
  if (platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "T3Code", "GasCity", "current");
  }
  return path.join(homedir(), ".local", "state", "t3code", "gascity", "current");
}

export function materializeGascityRuntime(
  options: MaterializeGascityRuntimeOptions,
): GascityRuntimeLayout {
  const rootDir = path.resolve(options.targetDir);
  const cityTargetDir = path.join(rootDir, "city");
  const configOptions: Mutable<MaterializeGascityConfigOptions> = {
    targetDir: cityTargetDir,
  };
  if (options.overwriteConfig !== undefined) {
    configOptions.overwrite = options.overwriteConfig;
  }
  const preserveExistingConfig =
    options.preserveExistingConfig === true &&
    options.overwriteConfig !== true &&
    hasMaterializedGascityConfig(cityTargetDir);
  const city = preserveExistingConfig
    ? getGascityConfigLayout(cityTargetDir)
    : materializeGascityConfig(configOptions);
  if (options.seedLocalBeadsConfig ?? true) {
    seedLocalBeadsConfig(city.rootDir);
  }
  const binaryTarget: Mutable<GascityBinaryTarget> = {};
  if (options.platform !== undefined) {
    binaryTarget.platform = options.platform;
  }
  if (options.arch !== undefined) {
    binaryTarget.arch = options.arch;
  }
  const sourceGcBinaryPath = options.gcBinaryPath ?? findBundledGcBinaryPath(binaryTarget);
  const sourceBdBinaryPath = options.bdBinaryPath ?? findBundledBdBinaryPath(binaryTarget);
  const sourceDoltliteLibraryPath =
    options.doltliteLibraryPath ??
    findSiblingDoltliteLibraryPath(sourceBdBinaryPath, binaryTarget) ??
    findBundledDoltliteLibraryPath(binaryTarget);
  const binaryPlatform = options.platform ?? process.platform;
  if (!sourceGcBinaryPath) {
    throw new Error(
      `No bundled Gas City binary found for ${options.platform ?? process.platform}-${
        options.arch ?? process.arch
      }. Provide gcBinaryPath or add a binary under ${binariesRoot}.`,
    );
  }
  if (!sourceBdBinaryPath) {
    throw new Error(
      `No bundled beads binary found for ${options.platform ?? process.platform}-${
        options.arch ?? process.arch
      }. Provide bdBinaryPath or add a binary under ${binariesRoot}.`,
    );
  }
  if (!existsSync(sourceGcBinaryPath) || !statSync(sourceGcBinaryPath).isFile()) {
    throw new Error(`Gas City binary does not exist or is not a file: ${sourceGcBinaryPath}`);
  }
  if (!existsSync(sourceBdBinaryPath) || !statSync(sourceBdBinaryPath).isFile()) {
    throw new Error(`beads binary does not exist or is not a file: ${sourceBdBinaryPath}`);
  }
  const brBinaryTarget =
    options.brBinaryPath === undefined
      ? binaryTarget
      : {
          ...binaryTarget,
          brBinaryPath: options.brBinaryPath,
        };
  const sourceBrBinaryPath = resolveManagedBrBinaryPath(brBinaryTarget);
  if (!existsSync(sourceBrBinaryPath) || !statSync(sourceBrBinaryPath).isFile()) {
    throw new Error(`beads_rust binary does not exist or is not a file: ${sourceBrBinaryPath}`);
  }

  const binDir = path.join(rootDir, "bin");
  const gcBinaryPath = path.join(binDir, path.basename(getBundledGcBinaryPath(options)));
  const bdBinaryPath = path.join(binDir, path.basename(getBundledBdBinaryPath(options)));
  const brBinaryPath = path.join(binDir, getBrExecutableName(options.platform));
  const doltliteLibraryPath = path.join(
    binDir,
    path.basename(getBundledDoltliteLibraryPath(options)),
  );
  mkdirSync(binDir, { recursive: true });
  copyRuntimeBinary(sourceGcBinaryPath, gcBinaryPath, binaryPlatform);
  copyRuntimeBinary(sourceBdBinaryPath, bdBinaryPath, binaryPlatform);
  copyRuntimeBinary(sourceBrBinaryPath, brBinaryPath, binaryPlatform);
  if (sourceDoltliteLibraryPath) {
    copyRuntimeBinary(sourceDoltliteLibraryPath, doltliteLibraryPath, binaryPlatform);
  }

  return {
    rootDir,
    city,
    binDir,
    gcBinaryPath,
    bdBinaryPath,
    brBinaryPath,
    doltliteLibraryPath,
  };
}

function isBuiltBrBinaryFresh(rigPath: string, binaryPath: string): boolean {
  if (!existsSync(binaryPath) || !statSync(binaryPath).isFile()) {
    return false;
  }
  const binaryMtime = statSync(binaryPath).mtimeMs;
  const sourceMtime = latestPathMtimeMs([
    path.join(rigPath, "Cargo.toml"),
    path.join(rigPath, "Cargo.lock"),
    path.join(rigPath, "build.rs"),
    path.join(rigPath, "rust-toolchain.toml"),
    path.join(rigPath, "src"),
  ]);
  return sourceMtime <= binaryMtime;
}

function latestPathMtimeMs(paths: readonly string[]): number {
  let latest = 0;
  for (const sourcePath of paths) {
    latest = Math.max(latest, latestSinglePathMtimeMs(sourcePath));
  }
  return latest;
}

function latestSinglePathMtimeMs(sourcePath: string): number {
  if (!existsSync(sourcePath)) {
    return 0;
  }
  const stat = statSync(sourcePath);
  let latest = stat.mtimeMs;
  if (!stat.isDirectory()) {
    return latest;
  }
  for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
    latest = Math.max(latest, latestSinglePathMtimeMs(path.join(sourcePath, entry.name)));
  }
  return latest;
}

function tailProcessOutput(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return lines.slice(-40).join("\n");
}

function findSiblingDoltliteLibraryPath(
  binaryPath: string | undefined,
  target: GascityBinaryTarget,
): string | undefined {
  if (!binaryPath) {
    return undefined;
  }
  const libraryPath = path.join(
    path.dirname(binaryPath),
    path.basename(getBundledDoltliteLibraryPath(target)),
  );
  return existsSync(libraryPath) && statSync(libraryPath).isFile() ? libraryPath : undefined;
}

function shouldCopyConfigPath(sourcePath: string): boolean {
  const parts = sourcePath.split(path.sep);
  return !parts.includes(".gc") && !parts.includes(".beads") && !parts.includes(".git");
}

function seedLocalBeadsConfig(cityDir: string): void {
  const beadsDir = path.join(cityDir, ".beads");
  const configPath = path.join(beadsDir, "config.yaml");
  mkdirSync(beadsDir, { recursive: true });
  if (existsSync(configPath)) {
    return;
  }
  writeFileSync(configPath, ["issue_prefix: ci", "issue-prefix: ci", ""].join("\n"));
}

function copyRuntimeBinary(
  sourceBinaryPath: string,
  targetBinaryPath: string,
  platform: NodeJS.Platform,
): void {
  const tempBinaryPath = `${targetBinaryPath}.${process.pid}.tmp`;
  try {
    cpSync(sourceBinaryPath, tempBinaryPath, { force: true });
    if (platform !== "win32") {
      chmodSync(tempBinaryPath, 0o755);
    }
    renameSync(tempBinaryPath, targetBinaryPath);
  } catch (error) {
    rmSync(tempBinaryPath, { force: true });
    throw error;
  }
}

function hasMaterializedGascityConfig(rootDir: string): boolean {
  return existsSync(path.join(rootDir, "city.toml")) && existsSync(path.join(rootDir, "pack.toml"));
}

export function assertBundledGascityConfigPresent(): void {
  for (const requiredPath of [
    ...getBundledGascityConfigLayouts().flatMap((layout) => [
      layout.cityTomlPath,
      layout.packTomlPath,
    ]),
    path.join(getBundledGascityConfigLayout().doltliteGastownPackDir, "pack.toml"),
    path.join(getBundledGascityConfigLayout().maintenancePackDir, "pack.toml"),
  ]) {
    if (!existsSync(requiredPath) || !statSync(requiredPath).isFile()) {
      throw new Error(`Bundled Gas City config is missing required file: ${requiredPath}`);
    }
  }
}
