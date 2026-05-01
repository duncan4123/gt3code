import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BEADS_DOLTLITE_PACKAGE_NAME = "@t3tools/beads-doltlite";

export interface BeadsDoltliteToolTarget {
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
}

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export function getBeadsDoltlitePackageRoot(): string {
  return packageRoot;
}

export function getBdExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "bd.exe" : "bd";
}

export function getBuiltBdBinaryPath(target: BeadsDoltliteToolTarget = {}): string {
  const platform = target.platform ?? process.platform;
  const arch = target.arch ?? process.arch;
  return path.join(packageRoot, "bin", `${platform}-${arch}`, getBdExecutableName(platform));
}

export function findBuiltBdBinaryPath(target: BeadsDoltliteToolTarget = {}): string | undefined {
  const binaryPath = getBuiltBdBinaryPath(target);
  return existsSync(binaryPath) && statSync(binaryPath).isFile() ? binaryPath : undefined;
}
