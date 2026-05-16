// @effect-diagnostics nodeBuiltinImport:off
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GASCITY_PACKAGE_NAME = "@t3tools/gascity";

export interface GascityToolTarget {
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
}

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export function getGascityPackageRoot(): string {
  return packageRoot;
}

export function getGcExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "gc.exe" : "gc";
}

export function getBuiltGcBinaryPath(target: GascityToolTarget = {}): string {
  const platform = target.platform ?? process.platform;
  const arch = target.arch ?? process.arch;
  return path.join(packageRoot, "bin", `${platform}-${arch}`, getGcExecutableName(platform));
}

export function findBuiltGcBinaryPath(target: GascityToolTarget = {}): string | undefined {
  const binaryPath = getBuiltGcBinaryPath(target);
  return existsSync(binaryPath) && statSync(binaryPath).isFile() ? binaryPath : undefined;
}

export function getBrBeadsProviderScriptPath(): string {
  return path.join(packageRoot, "source", "contrib", "beads-scripts", "gc-beads-br");
}

export function findBrBeadsProviderScriptPath(): string | undefined {
  const scriptPath = getBrBeadsProviderScriptPath();
  return existsSync(scriptPath) && statSync(scriptPath).isFile() ? scriptPath : undefined;
}
