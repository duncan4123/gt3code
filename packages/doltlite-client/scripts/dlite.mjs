#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = process.platform === "win32" ? "dlite.exe" : "dlite";
const binary = path.join(packageRoot, "bin", `${process.platform}-${process.arch}`, executable);

if (!existsSync(binary)) {
  console.error(`dlite binary not found: ${binary}`);
  console.error("Run `bun --filter @t3tools/doltlite-client build` first.");
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
