#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = path.resolve(packageRoot, "..", "..");
const platform = process.env.T3CODE_DOLTLITE_CLIENT_BUILD_PLATFORM || process.platform;
const arch = process.env.T3CODE_DOLTLITE_CLIENT_BUILD_ARCH || process.arch;
const goos = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
const goarch = arch === "x64" ? "amd64" : arch;
const executable = platform === "win32" ? "dlite.exe" : "dlite";
const library =
  platform === "win32"
    ? "doltlite.dll"
    : platform === "darwin"
      ? "libdoltlite.dylib"
      : "libdoltlite.so";
const outDir = path.join(packageRoot, "bin", `${platform}-${arch}`);
const libraryPath = path.join(outDir, library);
const librarySonamePath = platform === "linux" ? path.join(outDir, "libdoltlite.so.0") : undefined;
const sourceRoot = path.join(packageRoot, "source");
const doltliteBuildDir = resolveDoltliteBuildDir();

mkdirSync(outDir, { recursive: true });

const rpathFlag = platform === "darwin" ? "-Wl,-rpath,@loader_path" : "-Wl,-rpath,$ORIGIN";
const result = spawnSync("go", ["build", "-o", path.join(outDir, executable), "./cmd/dlite"], {
  cwd: sourceRoot,
  env: {
    ...process.env,
    CGO_ENABLED: "1",
    CGO_CFLAGS: appendFlag(process.env.CGO_CFLAGS, `-I${doltliteBuildDir}`),
    CGO_LDFLAGS: appendFlag(
      process.env.CGO_LDFLAGS,
      `-L${doltliteBuildDir} ${rpathFlag} -ldoltlite -lz -lpthread -lm`,
    ),
    GOOS: goos,
    GOARCH: goarch,
    GOFLAGS: appendFlag(process.env.GOFLAGS, "-tags=libsqlite3"),
  },
  stdio: "inherit",
});
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

copyDoltliteRuntimeLibrary();
console.log(`built ${path.join(outDir, executable)}`);

function resolveDoltliteBuildDir() {
  const candidates = [
    process.env.T3CODE_DOLTLITE_BUILD_DIR,
    process.env.DOLTLITE_BUILD_DIR,
    path.join(repoRoot, "packages", "doltlite", "build"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(path.join(resolved, library)) && existsSync(path.join(resolved, "sqlite3.h")))
      return resolved;
  }
  throw new Error(`doltlite build not found. Expected ${library} and sqlite3.h.`);
}

function appendFlag(existing, value) {
  return [existing, value].filter(Boolean).join(" ");
}

function copyDoltliteRuntimeLibrary() {
  const source = path.join(doltliteBuildDir, library);
  copyFileSync(source, libraryPath);
  if (librarySonamePath) {
    copyFileSync(source, librarySonamePath);
  }
}
