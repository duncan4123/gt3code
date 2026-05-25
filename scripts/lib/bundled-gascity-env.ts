// @effect-diagnostics importFromBarrel:off nodeBuiltinImport:off
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBundledGascityConfigLayout, usesDoltliteBeadsBackend } from "@t3tools/gascity-config";
import { Effect, Path } from "effect";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DEFAULT_GASCITY_API_URL = "http://127.0.0.1:8372";
export const DEFAULT_T3_HOME_PATH = join(repoRoot, ".t3-dev");
export const DEFAULT_T3CODE_GASCITY_HOME = join(DEFAULT_T3_HOME_PATH, "gascity");
export const DEFAULT_GC_CITY_PATH = getBundledGascityConfigLayout("gascity-br").rootDir;

export const DEFAULT_T3_HOME = Effect.map(Effect.service(Path.Path), (path) =>
  path.resolve(DEFAULT_T3_HOME_PATH),
);

function resolveBaseDir(baseDir: string | undefined): Effect.Effect<string, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const configured = baseDir?.trim();

    if (configured) {
      return path.resolve(configured);
    }

    return yield* DEFAULT_T3_HOME;
  });
}

export interface CreateBundledGascityProcessEnvInput {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly t3Home: string | undefined;
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
    "BEADS_DOLT_SERVER_PASSWORD",
    "BEADS_DOLT_SERVER_PORT",
    "BEADS_DOLT_SERVER_USER",
    "DOLT_HOST",
    "DOLT_PASSWORD",
    "DOLT_PORT",
    "DOLT_USER",
    "GC_DOLT_HOST",
    "GC_DOLT_PASSWORD",
    "GC_DOLT_PORT",
    "GC_DOLT_USER",
  ]) {
    delete env[key];
  }
}

function resolveGcApiUrl(baseEnv: NodeJS.ProcessEnv, gascityHome: string, path: Path.Path): string {
  const configured = baseEnv.GC_API_URL?.trim();
  if (configured) {
    return configured;
  }

  const supervisorTomlPath = path.join(gascityHome, "supervisor.toml");
  if (!existsSync(supervisorTomlPath)) {
    return DEFAULT_GASCITY_API_URL;
  }

  try {
    const content = readFileSync(supervisorTomlPath, "utf8");
    const port = content.match(/^\s*port\s*=\s*"?([0-9]+)"?\s*$/m)?.[1]?.trim();
    return port ? `http://127.0.0.1:${port}` : DEFAULT_GASCITY_API_URL;
  } catch {
    return DEFAULT_GASCITY_API_URL;
  }
}

function normalizeT3WsUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.endsWith("/ws") ? trimmed : `${trimmed.replace(/\/$/, "")}/ws`;
}

function mergeEnvList(existing: string | undefined, keys: ReadonlyArray<string>): string {
  const merged = new Set(
    (existing ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  for (const key of keys) {
    merged.add(key);
  }
  return [...merged].join(",");
}

export function createBundledGascityProcessEnv({
  baseEnv,
  t3Home,
}: CreateBundledGascityProcessEnvInput): Effect.Effect<NodeJS.ProcessEnv, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const resolvedBaseDir = yield* resolveBaseDir(t3Home ?? baseEnv.T3CODE_HOME);
    const gascityHome =
      baseEnv.T3CODE_GASCITY_HOME?.trim() || baseEnv.GC_HOME?.trim() || DEFAULT_T3CODE_GASCITY_HOME;
    const worktreesDir =
      baseEnv.T3CODE_WORKTREES_DIR?.trim() || path.join(resolvedBaseDir, "worktrees");
    const cityPath = baseEnv.GC_CITY_PATH ?? baseEnv.GC_CITY ?? DEFAULT_GC_CITY_PATH;
    const t3WsUrl = normalizeT3WsUrl(baseEnv.T3_WS_URL) ?? normalizeT3WsUrl(baseEnv.VITE_WS_URL);
    const env = { ...baseEnv } satisfies NodeJS.ProcessEnv;
    if (cityPath && usesDoltliteBeadsBackend(cityPath)) {
      env.GC_BEADS_BACKEND ??= "doltlite";
      env.BEADS_BACKEND ??= "doltlite";
      env.GC_NATIVE_DOLTLITE_BEADS ??= "true";
    }
    clearDoltServerEnv(env);

    const output: NodeJS.ProcessEnv = {
      ...env,
      T3_HOME: baseEnv.T3_HOME?.trim() || resolvedBaseDir,
      T3CODE_HOME: resolvedBaseDir,
      T3CODE_GASCITY_HOME: gascityHome,
      GC_HOME: gascityHome,
      T3CODE_WORKTREES_DIR: worktreesDir,
      GC_WORKTREES_DIR: baseEnv.GC_WORKTREES_DIR?.trim() || worktreesDir,
      GC_API_URL: resolveGcApiUrl(baseEnv, gascityHome, path),
      GC_BIN:
        baseEnv.GC_BIN ??
        path.join(gascityHome, "bin", process.platform === "win32" ? "gc.exe" : "gc"),
      BD_BIN:
        baseEnv.BD_BIN ??
        path.join(gascityHome, "bin", process.platform === "win32" ? "bd.exe" : "bd"),
    };
    if (t3WsUrl) {
      output.T3_WS_URL = t3WsUrl;
    }
    output.GC_SUPERVISOR_ENV = mergeEnvList(output.GC_SUPERVISOR_ENV, [
      "T3_HOME",
      "T3CODE_HOME",
      "T3_WS_URL",
      "T3CODE_GASCITY_HOME",
      "GC_BIN",
      "BD_BIN",
      "BR_BIN",
      "T3CODE_WORKTREES_DIR",
      "GC_WORKTREES_DIR",
      "GC_API_URL",
      "GC_BEADS_BACKEND",
      "BEADS_BACKEND",
      "GC_NATIVE_DOLTLITE_BEADS",
      "DOLTLITE_LIBRARY",
      "LD_LIBRARY_PATH",
      "DYLD_LIBRARY_PATH",
    ]);
    if (cityPath) {
      output.GC_CITY_PATH = cityPath;
    }
    return output;
  });
}
