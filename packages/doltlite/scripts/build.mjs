#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = path.join(packageRoot, "source");
const buildRoot = path.join(packageRoot, "build");
const libraryName =
  process.platform === "darwin"
    ? "libdoltlite.dylib"
    : process.platform === "win32"
      ? "doltlite.dll"
      : "libdoltlite.so";

if (!existsSync(path.join(sourceRoot, "configure"))) {
  throw new Error("Doltlite source not found. Expected packages/doltlite/source/configure.");
}

mkdirSync(buildRoot, { recursive: true });

if (!existsSync(path.join(buildRoot, "Makefile"))) {
  run(path.join(sourceRoot, "configure"), [], buildRoot);
}

run("make", ["doltlite-lib"], buildRoot);

for (const file of [libraryName, "sqlite3.h"]) {
  if (!existsSync(path.join(buildRoot, file))) {
    throw new Error(`Doltlite build did not produce ${file}`);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
