#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = path.join(packageRoot, "source");
const buildRoot = path.join(packageRoot, "build");
const stampPath = path.join(buildRoot, ".t3-doltlite-build-stamp.json");
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

const outputs = [path.join(buildRoot, libraryName), path.join(buildRoot, "sqlite3.h")];
const stamp = {
  platform: process.platform,
  arch: process.arch,
  command: "make doltlite-lib",
};

if (isFresh({ outputs, stampPath, stamp, inputRoots: [sourceRoot], extraInputs: [import.meta.url] })) {
  console.log("[doltlite build] outputs are current; skipping.");
  process.exit(0);
}

run("make", ["doltlite-lib"], buildRoot);

for (const file of [libraryName, "sqlite3.h"]) {
  if (!existsSync(path.join(buildRoot, file))) {
    throw new Error(`Doltlite build did not produce ${file}`);
  }
}

writeFileSync(stampPath, JSON.stringify({ ...stamp, builtAt: new Date().toISOString() }) + "\n");

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

function isFresh({ outputs, stampPath, stamp, inputRoots, extraInputs }) {
  if (!outputs.every((output) => existsSync(output)) || !existsSync(stampPath)) return false;
  try {
    const previous = JSON.parse(readFileSync(stampPath, "utf8"));
    for (const [key, value] of Object.entries(stamp)) {
      if (previous[key] !== value) return false;
    }

    const newestInput = Math.max(
      ...inputRoots.map((root) => newestSourceMtime(root)),
      ...extraInputs.map((input) => statSync(fileURLToPathSafe(input)).mtimeMs),
    );
    return statSync(stampPath).mtimeMs >= newestInput;
  } catch {
    return false;
  }
}

function newestSourceMtime(root) {
  let newest = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = statSync(current);
    if (stat.isDirectory()) {
      const base = path.basename(current);
      if (base === ".git" || base === "build") continue;
      for (const entry of readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
      continue;
    }
    if (isBuildInput(current)) {
      newest = Math.max(newest, stat.mtimeMs);
    }
  }
  return newest;
}

function isBuildInput(file) {
  const base = path.basename(file);
  return (
    base === "Makefile" ||
    base === "configure" ||
    base === "manifest" ||
    base === "manifest.uuid" ||
    /\.(c|cc|cpp|h|hh|hpp|in|mk|tcl)$/.test(base)
  );
}

function fileURLToPathSafe(value) {
  return value.startsWith("file:") ? fileURLToPath(value) : value;
}
