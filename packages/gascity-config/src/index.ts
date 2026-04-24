import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const configRoot = path.join(packageRoot, "config");
const binariesRoot = path.join(packageRoot, "binaries");

export function getBundledGascityConfigLayout(): GascityConfigLayout {
  return {
    rootDir: configRoot,
    cityTomlPath: path.join(configRoot, "city.toml"),
    packTomlPath: path.join(configRoot, "pack.toml"),
    packsDir: path.join(configRoot, "packs"),
    gastownPackDir: path.join(configRoot, "packs", "gastown"),
    maintenancePackDir: path.join(configRoot, "packs", "maintenance"),
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

  return {
    rootDir: targetDir,
    cityTomlPath: path.join(targetDir, "city.toml"),
    packTomlPath: path.join(targetDir, "pack.toml"),
    packsDir: path.join(targetDir, "packs"),
    gastownPackDir: path.join(targetDir, "packs", "gastown"),
    maintenancePackDir: path.join(targetDir, "packs", "maintenance"),
  };
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

export function materializeGascityRuntime(
  options: MaterializeGascityRuntimeOptions,
): GascityRuntimeLayout {
  const rootDir = path.resolve(options.targetDir);
  const configOptions: Mutable<MaterializeGascityConfigOptions> = {
    targetDir: path.join(rootDir, "city"),
  };
  if (options.overwriteConfig !== undefined) {
    configOptions.overwrite = options.overwriteConfig;
  }
  const city = materializeGascityConfig(configOptions);
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
  cpSync(sourceBinaryPath, gcBinaryPath, { force: true });
  if (process.platform !== "win32") {
    chmodSync(gcBinaryPath, 0o755);
  }

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
  mkdirSync(beadsDir, { recursive: true });
  writeFileSync(
    path.join(beadsDir, "config.yaml"),
    [
      "issue_prefix: ci",
      "issue-prefix: ci",
      "",
    ].join("\n"),
  );
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
