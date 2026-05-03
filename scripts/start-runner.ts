#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Data, Effect, Layer, Logger, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";

import { createBundledGascityProcessEnv } from "./lib/bundled-gascity-env.ts";

class StartRunnerError extends Data.TaggedError("StartRunnerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const optionalStringConfig = (name: string): Config.Config<string | undefined> =>
  Config.string(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );

interface StartRunnerInput {
  readonly t3Home: string | undefined;
  readonly dryRun: boolean;
  readonly turboArgs: ReadonlyArray<string>;
}

export const createStartRunnerEnv = (input: {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly t3Home: string | undefined;
}) => createBundledGascityProcessEnv(input);

const runStartRunner = (input: StartRunnerInput) =>
  Effect.gen(function* () {
    const env = yield* createStartRunnerEnv({
      baseEnv: process.env,
      t3Home: input.t3Home,
    });

    yield* Effect.logInfo(
      `[start-runner] baseDir=${String(env.T3CODE_HOME)} gcHome=${String(env.T3CODE_GASCITY_HOME)} gcCity=${String(env.GC_CITY_PATH)}`,
    );

    if (input.dryRun) {
      return;
    }

    const child = yield* ChildProcess.make(
      "turbo",
      ["run", "start", "--filter=t3", ...input.turboArgs],
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env,
        extendEnv: false,
        shell: process.platform === "win32",
        detached: false,
        forceKillAfter: "1500 millis",
      },
    );

    const exitCode = yield* child.exitCode;
    if (exitCode !== 0) {
      return yield* new StartRunnerError({
        message: `turbo exited with code ${exitCode}`,
      });
    }
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof StartRunnerError
        ? cause
        : new StartRunnerError({
            message: cause instanceof Error ? cause.message : "start-runner failed",
            cause,
          }),
    ),
  );

const startRunnerCli = Command.make("start-runner", {
  t3Home: Flag.string("home-dir").pipe(
    Flag.withDescription("Base directory for all T3 Code data (equivalent to T3CODE_HOME)."),
    Flag.withFallbackConfig(optionalStringConfig("T3CODE_HOME")),
  ),
  dryRun: Flag.boolean("dry-run").pipe(
    Flag.withDescription("Resolve bundled GC env and print, but do not spawn turbo."),
    Flag.withDefault(false),
  ),
  turboArgs: Argument.string("turbo-arg").pipe(
    Argument.withDescription("Additional turbo args (pass after `--`)."),
    Argument.variadic(),
  ),
}).pipe(
  Command.withDescription("Run monorepo start mode with bundled Gas City env wiring."),
  Command.withHandler((input) => runStartRunner(input)),
);

const runtimeLayer = Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer);

const runtimeProgram = Command.run(startRunnerCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(runtimeLayer),
);

NodeRuntime.runMain(runtimeProgram);
