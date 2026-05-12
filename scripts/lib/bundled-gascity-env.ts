import * as NodeOS from "node:os";

import { getDefaultGascityRuntimeRoot, usesDoltliteBeadsBackend } from "@t3tools/gascity-config";
import { Effect, Path } from "effect";

export const DEFAULT_GASCITY_API_URL = "http://127.0.0.1:8372";
export const DEFAULT_T3CODE_GASCITY_HOME = getDefaultGascityRuntimeRoot();
export const DEFAULT_GC_CITY_PATH = "";

export const DEFAULT_T3_HOME = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(NodeOS.homedir(), ".t3"),
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

export function createBundledGascityProcessEnv({
  baseEnv,
  t3Home,
}: CreateBundledGascityProcessEnvInput): Effect.Effect<NodeJS.ProcessEnv, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const resolvedBaseDir = yield* resolveBaseDir(t3Home ?? baseEnv.T3CODE_HOME);
    const gascityHome = baseEnv.T3CODE_GASCITY_HOME?.trim() || DEFAULT_T3CODE_GASCITY_HOME;
    const worktreesDir =
      baseEnv.T3CODE_WORKTREES_DIR?.trim() || path.join(resolvedBaseDir, "worktrees");
    const cityPath = baseEnv.GC_CITY_PATH ?? baseEnv.GC_CITY;
    const env = { ...baseEnv } satisfies NodeJS.ProcessEnv;
    if (cityPath && usesDoltliteBeadsBackend(cityPath)) {
      env.GC_BEADS_BACKEND ??= "doltlite";
      env.BEADS_BACKEND ??= "doltlite";
    }
    clearDoltServerEnv(env);

    const output: NodeJS.ProcessEnv = {
      ...env,
      T3CODE_HOME: resolvedBaseDir,
      T3CODE_GASCITY_HOME: gascityHome,
      T3CODE_WORKTREES_DIR: worktreesDir,
      GC_WORKTREES_DIR: baseEnv.GC_WORKTREES_DIR?.trim() || worktreesDir,
      GC_API_URL: baseEnv.GC_API_URL ?? DEFAULT_GASCITY_API_URL,
      GC_BIN:
        baseEnv.GC_BIN ??
        path.join(gascityHome, "bin", process.platform === "win32" ? "gc.exe" : "gc"),
      BD_BIN:
        baseEnv.BD_BIN ??
        path.join(gascityHome, "bin", process.platform === "win32" ? "bd.exe" : "bd"),
    };
    if (cityPath) {
      output.GC_CITY_PATH = cityPath;
    }
    return output;
  });
}
