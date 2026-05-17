// @effect-diagnostics importFromBarrel:off nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { mkdtempSync, writeFileSync } from "node:fs";
import * as NodeOS from "node:os";
import { assert, it } from "@effect/vitest";
import { Effect, Path } from "effect";

import {
  DEFAULT_GC_CITY_PATH,
  DEFAULT_T3CODE_GASCITY_HOME,
  createBundledGascityProcessEnv,
} from "./bundled-gascity-env.ts";
import { getBundledGascityConfigLayout } from "@t3tools/gascity-config";

it.layer(NodeServices.layer)("bundled-gascity-env", (it) => {
  it.effect("fills bundled GC runtime env defaults", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const env = yield* createBundledGascityProcessEnv({
        baseEnv: {},
        t3Home: undefined,
      });

      const expectedHome = path.resolve(import.meta.dirname, "..", "..", ".t3-dev");
      const expectedWorktreesDir = path.join(expectedHome, "worktrees");
      const expectedBinDir = path.join(DEFAULT_T3CODE_GASCITY_HOME, "bin");

      assert.equal(env.T3CODE_HOME, expectedHome);
      assert.equal(env.T3CODE_GASCITY_HOME, DEFAULT_T3CODE_GASCITY_HOME);
      assert.equal(env.GC_HOME, DEFAULT_T3CODE_GASCITY_HOME);
      assert.equal(env.T3CODE_WORKTREES_DIR, expectedWorktreesDir);
      assert.equal(env.GC_WORKTREES_DIR, expectedWorktreesDir);
      assert.equal(DEFAULT_GC_CITY_PATH, getBundledGascityConfigLayout("gascity-br").rootDir);
      assert.equal(env.GC_CITY_PATH, DEFAULT_GC_CITY_PATH);
      assert.match(env.GC_API_URL ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(env.GC_BEADS_BACKEND, undefined);
      assert.equal(env.BEADS_BACKEND, undefined);
      assert.equal(
        env.GC_BIN,
        path.join(expectedBinDir, process.platform === "win32" ? "gc.exe" : "gc"),
      );
      assert.equal(
        env.BD_BIN,
        path.join(expectedBinDir, process.platform === "win32" ? "bd.exe" : "bd"),
      );
    }),
  );

  it.effect("uses the managed supervisor port when GC_API_URL is not explicit", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const runtimeHome = mkdtempSync(path.join(NodeOS.tmpdir(), "t3-gc-env-supervisor-"));
      writeFileSync(path.join(runtimeHome, "supervisor.toml"), "[supervisor]\nport = 38527\n");

      const env = yield* createBundledGascityProcessEnv({
        baseEnv: {
          T3CODE_GASCITY_HOME: runtimeHome,
        },
        t3Home: undefined,
      });

      assert.equal(env.GC_API_URL, "http://127.0.0.1:38527");
    }),
  );

  it.effect("preserves explicit base env overrides", () =>
    Effect.gen(function* () {
      const env = yield* createBundledGascityProcessEnv({
        baseEnv: {
          T3CODE_HOME: "/tmp/base-home",
          T3CODE_GASCITY_HOME: "/tmp/gc-home",
          T3CODE_WORKTREES_DIR: "/tmp/worktrees",
          GC_WORKTREES_DIR: "/tmp/gc-worktrees",
          GC_API_URL: "http://127.0.0.1:9999",
          GC_BIN: "/tmp/bin/gc",
          BD_BIN: "/tmp/bin/bd",
          GC_CITY_PATH: "/tmp/city",
        },
        t3Home: undefined,
      });

      assert.equal(env.T3CODE_HOME, "/tmp/base-home");
      assert.equal(env.T3CODE_GASCITY_HOME, "/tmp/gc-home");
      assert.equal(env.GC_HOME, "/tmp/gc-home");
      assert.equal(env.T3CODE_WORKTREES_DIR, "/tmp/worktrees");
      assert.equal(env.GC_WORKTREES_DIR, "/tmp/gc-worktrees");
      assert.equal(env.GC_API_URL, "http://127.0.0.1:9999");
      assert.equal(env.GC_BIN, "/tmp/bin/gc");
      assert.equal(env.BD_BIN, "/tmp/bin/bd");
      assert.equal(env.GC_CITY_PATH, "/tmp/city");
    }),
  );

  it.effect("does not force doltlite backend for the beads-rust city", () =>
    Effect.gen(function* () {
      const cityPath = getBundledGascityConfigLayout("gascity-br").rootDir;
      const env = yield* createBundledGascityProcessEnv({
        baseEnv: {
          GC_CITY_PATH: cityPath,
        },
        t3Home: undefined,
      });

      assert.equal(env.GC_CITY_PATH, cityPath);
      assert.equal(env.GC_CITY_PATH, DEFAULT_GC_CITY_PATH);
      assert.equal(env.GC_BEADS_BACKEND, undefined);
      assert.equal(env.BEADS_BACKEND, undefined);
    }),
  );

  it.effect("forces doltlite backend for the gastown city", () =>
    Effect.gen(function* () {
      const cityPath = getBundledGascityConfigLayout("gastown").rootDir;
      const env = yield* createBundledGascityProcessEnv({
        baseEnv: {
          GC_CITY_PATH: cityPath,
        },
        t3Home: undefined,
      });

      assert.equal(env.GC_CITY_PATH, cityPath);
      assert.equal(env.GC_BEADS_BACKEND, "doltlite");
      assert.equal(env.BEADS_BACKEND, "doltlite");
    }),
  );

  it.effect("drops stale Dolt server env while keeping bundled runtime wiring", () =>
    Effect.gen(function* () {
      const env = yield* createBundledGascityProcessEnv({
        baseEnv: {
          GC_DOLT_PORT: "3307",
          GC_DOLT_HOST: "127.0.0.1",
          BEADS_DOLT_PORT: "3307",
          BEADS_DOLT_SERVER_HOST: "127.0.0.1",
          BEADS_DOLT_SHARED_SERVER: "true",
        },
        t3Home: undefined,
      });

      assert.equal(env.GC_DOLT_PORT, undefined);
      assert.equal(env.GC_DOLT_HOST, undefined);
      assert.equal(env.BEADS_DOLT_PORT, undefined);
      assert.equal(env.BEADS_DOLT_SERVER_HOST, undefined);
      assert.equal(env.BEADS_DOLT_SHARED_SERVER, undefined);
      assert.equal(env.GC_BEADS_BACKEND, undefined);
      assert.equal(env.BEADS_BACKEND, undefined);
    }),
  );

  it.effect("uses GC_HOME as the bundled Gas City home when T3CODE_GASCITY_HOME is unset", () =>
    Effect.gen(function* () {
      const env = yield* createBundledGascityProcessEnv({
        baseEnv: {
          GC_HOME: "/tmp/internal-gc-home",
        },
        t3Home: undefined,
      });

      assert.equal(env.T3CODE_GASCITY_HOME, "/tmp/internal-gc-home");
      assert.equal(env.GC_HOME, "/tmp/internal-gc-home");
    }),
  );
});
