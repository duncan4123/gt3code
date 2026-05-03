import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import { assert, it } from "@effect/vitest";
import { Effect, Path } from "effect";

import {
  DEFAULT_GC_CITY_PATH,
  DEFAULT_T3CODE_GASCITY_HOME,
  createBundledGascityProcessEnv,
} from "./bundled-gascity-env.ts";

it.layer(NodeServices.layer)("bundled-gascity-env", (it) => {
  it.effect("fills bundled GC runtime env defaults", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const env = yield* createBundledGascityProcessEnv({
        baseEnv: {},
        t3Home: undefined,
      });

      const expectedHome = path.resolve(NodeOS.homedir(), ".t3");
      const expectedWorktreesDir = path.join(expectedHome, "worktrees");
      const expectedBinDir = path.join(DEFAULT_T3CODE_GASCITY_HOME, "bin");

      assert.equal(env.T3CODE_HOME, expectedHome);
      assert.equal(env.T3CODE_GASCITY_HOME, DEFAULT_T3CODE_GASCITY_HOME);
      assert.equal(env.T3CODE_WORKTREES_DIR, expectedWorktreesDir);
      assert.equal(env.GC_WORKTREES_DIR, expectedWorktreesDir);
      assert.equal(env.GC_CITY_PATH, DEFAULT_GC_CITY_PATH);
      assert.equal(env.GC_API_URL, "http://127.0.0.1:8372");
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
      assert.equal(env.T3CODE_WORKTREES_DIR, "/tmp/worktrees");
      assert.equal(env.GC_WORKTREES_DIR, "/tmp/gc-worktrees");
      assert.equal(env.GC_API_URL, "http://127.0.0.1:9999");
      assert.equal(env.GC_BIN, "/tmp/bin/gc");
      assert.equal(env.BD_BIN, "/tmp/bin/bd");
      assert.equal(env.GC_CITY_PATH, "/tmp/city");
    }),
  );
});
