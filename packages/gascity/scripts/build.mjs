#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const platform = process.env.T3CODE_GASCITY_BUILD_PLATFORM || process.platform;
const arch = process.env.T3CODE_GASCITY_BUILD_ARCH || process.arch;
const goos = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
const goarch = arch === "x64" ? "amd64" : arch;
const executable = platform === "win32" ? "gc.exe" : "gc";
const doltliteLibrary =
  platform === "win32"
    ? "doltlite.dll"
    : platform === "darwin"
      ? "libdoltlite.dylib"
      : "libdoltlite.so";
const outputPath = path.join(packageRoot, "bin", `${platform}-${arch}`, executable);
const outputLibraryPath = path.join(packageRoot, "bin", `${platform}-${arch}`, doltliteLibrary);
const stampPath = path.join(
  packageRoot,
  "bin",
  `${platform}-${arch}`,
  ".t3-gascity-build-stamp.json",
);
const sourceRoot = resolveSourceRoot();
const doltliteBuildDir = resolveDoltliteBuildDir();

mkdirSync(path.dirname(outputPath), { recursive: true });
const cgoFlags = appendFlag(process.env.CGO_CFLAGS, `-I${doltliteBuildDir}`);
const rpathFlag = platform === "darwin" ? "-Wl,-rpath,@loader_path" : "-Wl,-rpath,$ORIGIN";
const cgoLdFlags = appendFlag(
  process.env.CGO_LDFLAGS,
  `-L${doltliteBuildDir} ${rpathFlag} -ldoltlite -lz`,
);

const stamp = {
  platform,
  arch,
  goos,
  goarch,
  cgoFlags,
  cgoLdFlags,
  goflags: appendFlag(process.env.GOFLAGS, "-tags=libsqlite3"),
  sourceRoot,
  doltliteBuildDir,
};
if (
  isFresh({
    outputs: [outputPath, outputLibraryPath],
    stampPath,
    stamp,
    inputRoots: [sourceRoot],
    extraInputs: [
      import.meta.url,
      path.join(doltliteBuildDir, doltliteLibrary),
      path.join(doltliteBuildDir, "sqlite3.h"),
    ],
  })
) {
  console.log("[gascity build] outputs are current; skipping.");
  process.exit(0);
}

const result = spawnSync("go", ["build", "-o", outputPath, "./cmd/gc"], {
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
  writeFileSync(stampPath, JSON.stringify({ ...stamp, builtAt: new Date().toISOString() }) + "\n");
  console.log(`copied ${outputLibraryPath}`);
}

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
    path.join(packageRoot, "..", "doltlite", "build"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (hasDoltliteBuildArtifacts(resolved)) {
      return resolved;
    }
  }
  throw new Error(
    `doltlite build not found. Build doltlite first or set T3CODE_DOLTLITE_BUILD_DIR. Expected ${doltliteLibrary} and sqlite3.h.`,
  );
}

function hasDoltliteBuildArtifacts(buildDir) {
  return (
    existsSync(path.join(buildDir, doltliteLibrary)) && existsSync(path.join(buildDir, "sqlite3.h"))
  );
}

function appendFlag(existing, value) {
  return [existing, value].filter(Boolean).join(" ");
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
      if (base === ".git" || base === "dist" || base === "bin") continue;
      for (const entry of readdirSync(current)) stack.push(path.join(current, entry));
      continue;
    }
    if (isGoBuildInput(current)) newest = Math.max(newest, stat.mtimeMs);
  }
  return newest;
}

function isGoBuildInput(file) {
  const base = path.basename(file);
  return base === "go.mod" || base === "go.sum" || /\.(go|c|h|s|S)$/.test(base);
}

function fileURLToPathSafe(value) {
  return value.startsWith("file:") ? fileURLToPath(value) : value;
}
