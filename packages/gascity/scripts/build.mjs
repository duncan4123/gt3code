#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const platform = process.env.T3CODE_GASCITY_BUILD_PLATFORM || process.platform;
const arch = process.env.T3CODE_GASCITY_BUILD_ARCH || process.arch;
const goos = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
const goarch = arch === "x64" ? "amd64" : arch;
const executable = platform === "win32" ? "gc.exe" : "gc";
const outputPath = path.join(packageRoot, "bin", `${platform}-${arch}`, executable);
const sourceRoot = resolveSourceRoot();

mkdirSync(path.dirname(outputPath), { recursive: true });
const result = spawnSync("go", ["build", "-o", outputPath, "./cmd/gc"], {
  cwd: sourceRoot,
  env: {
    ...process.env,
    GOOS: goos,
    GOARCH: goarch,
  },
  stdio: "inherit",
});

process.exit(result.status ?? 1);

function resolveSourceRoot() {
  const candidates = [
    process.env.T3CODE_GASCITY_SOURCE_DIR,
    process.env.GASCITY_SOURCE_DIR,
    path.join(packageRoot, "source"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(path.join(resolved, "go.mod")) && existsSync(path.join(resolved, "cmd", "gc"))) {
      return resolved;
    }
  }
  throw new Error(
    "Gas City source not found. Set T3CODE_GASCITY_SOURCE_DIR or add packages/gascity/source.",
  );
}
