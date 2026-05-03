#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const platform = process.env.T3CODE_BEADS_DOLTLITE_BUILD_PLATFORM || process.platform;
const arch = process.env.T3CODE_BEADS_DOLTLITE_BUILD_ARCH || process.arch;
const goos = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
const goarch = arch === "x64" ? "amd64" : arch;
const executable = platform === "win32" ? "bd.exe" : "bd";
const doltliteLibrary =
  platform === "win32"
    ? "doltlite.dll"
    : platform === "darwin"
      ? "libdoltlite.dylib"
      : "libdoltlite.so";
const outputPath = path.join(packageRoot, "bin", `${platform}-${arch}`, executable);
const outputLibraryPath = path.join(packageRoot, "bin", `${platform}-${arch}`, doltliteLibrary);
const sourceRoot = resolveSourceRoot();
const doltliteBuildDir = resolveDoltliteBuildDir();

mkdirSync(path.dirname(outputPath), { recursive: true });
const cgoFlags = appendFlag(process.env.CGO_CFLAGS, `-I${doltliteBuildDir}`);
const rpathFlag = platform === "darwin" ? "-Wl,-rpath,@loader_path" : "-Wl,-rpath,$ORIGIN";
const cgoLdFlags = appendFlag(
  process.env.CGO_LDFLAGS,
  `-L${doltliteBuildDir} ${rpathFlag} -ldoltlite -lz`,
);
const result = spawnSync("go", ["build", "-o", outputPath, "./cmd/bd"], {
  cwd: sourceRoot,
  env: {
    ...process.env,
    CGO_ENABLED: "1",
    CGO_CFLAGS: cgoFlags,
    CGO_LDFLAGS: cgoLdFlags,
    GOOS: goos,
    GOARCH: goarch,
    GOFLAGS: appendFlag(process.env.GOFLAGS, "-tags=libsqlite3"),
  },
  stdio: "inherit",
});

if ((result.status ?? 1) === 0) {
  copyFileSync(path.join(doltliteBuildDir, doltliteLibrary), outputLibraryPath);
  console.log(`copied ${outputLibraryPath}`);
}

process.exit(result.status ?? 1);

function resolveSourceRoot() {
  const candidates = [
    process.env.T3CODE_BEADS_DOLTLITE_SOURCE_DIR,
    process.env.BEADS_DOLTLITE_SOURCE_DIR,
    path.join(packageRoot, "source"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(path.join(resolved, "go.mod")) && existsSync(path.join(resolved, "cmd", "bd"))) {
      return resolved;
    }
  }
  throw new Error(
    "beads-doltlite source not found. Set T3CODE_BEADS_DOLTLITE_SOURCE_DIR or add packages/beads-doltlite/source.",
  );
}

function resolveDoltliteBuildDir() {
  const candidates = [
    process.env.T3CODE_DOLTLITE_BUILD_DIR,
    process.env.DOLTLITE_BUILD_DIR,
    process.env.T3CODE_DOLTLITE_SOURCE_DIR
      ? path.join(process.env.T3CODE_DOLTLITE_SOURCE_DIR, "build")
      : undefined,
    process.env.DOLTLITE_SOURCE_DIR
      ? path.join(process.env.DOLTLITE_SOURCE_DIR, "build")
      : undefined,
    path.join(packageRoot, "doltlite", "build"),
    path.join(packageRoot, "..", "doltlite", "build"),
    path.join(packageRoot, "..", "..", "..", "doltlite", "build"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (
      existsSync(path.join(resolved, doltliteLibrary)) &&
      existsSync(path.join(resolved, "sqlite3.h"))
    ) {
      return resolved;
    }
  }
  throw new Error(
    `doltlite build not found. Build doltlite first or set T3CODE_DOLTLITE_BUILD_DIR. Expected ${doltliteLibrary} and sqlite3.h.`,
  );
}

function appendFlag(existing, value) {
  return [existing, value].filter(Boolean).join(" ");
}
