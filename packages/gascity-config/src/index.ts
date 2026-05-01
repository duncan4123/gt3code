import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
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

export interface GascityConfigLayout {
  readonly rootDir: string;
  readonly cityTomlPath: string;
  readonly packTomlPath: string;
  readonly packsDir: string;
  readonly gastownPackDir: string;
  readonly maintenancePackDir: string;
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
}

const modulePackageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function hasBundledGascityConfigRoot(candidateRoot: string): boolean {
  return (
    existsSync(path.join(candidateRoot, "config", "city.toml")) &&
    existsSync(path.join(candidateRoot, "config", "pack.toml"))
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
const configRoot = path.join(packageRoot, "config");
const binariesRoot = path.join(packageRoot, "binaries");

export function getBundledGascityConfigLayout(): GascityConfigLayout {
  return getGascityConfigLayout(configRoot);
}

function getGascityConfigLayout(rootDir: string): GascityConfigLayout {
  return {
    rootDir,
    cityTomlPath: path.join(rootDir, "city.toml"),
    packTomlPath: path.join(rootDir, "pack.toml"),
    packsDir: path.join(rootDir, "packs"),
    gastownPackDir: path.join(rootDir, "packs", "gastown"),
    maintenancePackDir: path.join(rootDir, "packs", "maintenance"),
  };
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

  return getGascityConfigLayout(targetDir);
}

export function getBundledGcBinaryPath(target: GascityBinaryTarget = {}): string {
  const platform = target.platform ?? process.platform;
  const arch = target.arch ?? process.arch;
  const executable = platform === "win32" ? "gc.exe" : "gc";
  return path.join(binariesRoot, `${platform}-${arch}`, executable);
}

export function findBundledGcBinaryPath(target: GascityBinaryTarget = {}): string | undefined {
  const binaryPath = getBundledGcBinaryPath(target);
  return existsSync(binaryPath) && statSync(binaryPath).isFile() ? binaryPath : undefined;
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
  const sourceBinaryPath = options.gcBinaryPath ?? findBundledGcBinaryPath(binaryTarget);
  const binaryPlatform = options.platform ?? process.platform;
  if (!sourceBinaryPath) {
    throw new Error(
      `No bundled Gas City binary found for ${options.platform ?? process.platform}-${
        options.arch ?? process.arch
      }. Provide gcBinaryPath or add a binary under ${binariesRoot}.`,
    );
  }
  if (!existsSync(sourceBinaryPath) || !statSync(sourceBinaryPath).isFile()) {
    throw new Error(`Gas City binary does not exist or is not a file: ${sourceBinaryPath}`);
  }

  const binDir = path.join(rootDir, "bin");
  const gcBinaryPath = path.join(binDir, path.basename(getBundledGcBinaryPath(options)));
  mkdirSync(binDir, { recursive: true });
  copyGcBinary(sourceBinaryPath, gcBinaryPath, binaryPlatform);

  return {
    rootDir,
    city,
    binDir,
    gcBinaryPath,
  };
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

function copyGcBinary(
  sourceBinaryPath: string,
  gcBinaryPath: string,
  platform: NodeJS.Platform,
): void {
  const tempBinaryPath = `${gcBinaryPath}.${process.pid}.tmp`;
  try {
    cpSync(sourceBinaryPath, tempBinaryPath, { force: true });
    if (platform !== "win32") {
      chmodSync(tempBinaryPath, 0o755);
    }
    renameSync(tempBinaryPath, gcBinaryPath);
  } catch (error) {
    rmSync(tempBinaryPath, { force: true });
    throw error;
  }
}

function hasMaterializedGascityConfig(rootDir: string): boolean {
  return existsSync(path.join(rootDir, "city.toml")) && existsSync(path.join(rootDir, "pack.toml"));
}

export function assertBundledGascityConfigPresent(): void {
  const layout = getBundledGascityConfigLayout();
  for (const requiredPath of [
    layout.cityTomlPath,
    layout.packTomlPath,
    path.join(layout.gastownPackDir, "pack.toml"),
    path.join(layout.maintenancePackDir, "pack.toml"),
  ]) {
    if (!existsSync(requiredPath) || !statSync(requiredPath).isFile()) {
      throw new Error(`Bundled Gas City config is missing required file: ${requiredPath}`);
    }
  }
}
