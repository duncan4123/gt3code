// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const bundledRigDir = join(
  repoRoot,
  "packages",
  "gascity-config",
  "config",
  "cities",
  "gascity-br",
  "rigs",
  "beads_rust",
);
const binaryName = process.platform === "win32" ? "br.exe" : "br";
const bundledBinaryPath = join(bundledRigDir, "target", "release", binaryName);

function isFile(path: string | undefined): path is string {
  return path !== undefined && existsSync(path) && statSync(path).isFile();
}

function runCargoBuild(sourceDir: string, targetDir?: string): string {
  const manifestPath = join(sourceDir, "Cargo.toml");
  const args = ["build", "--release", "--manifest-path", manifestPath];
  if (targetDir) {
    args.push("--target-dir", targetDir);
  }
  const result = spawnSync("cargo", args, {
    cwd: sourceDir,
    encoding: "utf8",
    env: {
      ...process.env,
      CARGO_TERM_COLOR: "never",
    },
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`cargo build failed for ${sourceDir}`);
  }
  return join(targetDir ?? join(sourceDir, "target"), "release", binaryName);
}

function copyManagedBinary(sourceBinaryPath: string): void {
  mkdirSync(dirname(bundledBinaryPath), { recursive: true });
  copyFileSync(sourceBinaryPath, bundledBinaryPath);
  if (process.platform !== "win32") {
    chmodSync(bundledBinaryPath, 0o755);
  }
  console.log(`built ${bundledBinaryPath}`);
}

const overrideBinary = process.env.BR_BINARY?.trim();
if (isFile(overrideBinary)) {
  copyManagedBinary(overrideBinary);
  process.exit(0);
}

const bundledManifestPath = join(bundledRigDir, "Cargo.toml");
if (isFile(bundledManifestPath)) {
  copyManagedBinary(runCargoBuild(bundledRigDir, join(bundledRigDir, "target")));
  process.exit(0);
}

const sourceCandidates = [
  process.env.BEADS_RUST_DIR?.trim(),
  process.env.BR_SOURCE_DIR?.trim(),
  join(dirname(repoRoot), "beads_rust"),
].filter((candidate): candidate is string => Boolean(candidate));

for (const sourceDir of sourceCandidates) {
  if (isFile(join(sourceDir, "Cargo.toml"))) {
    copyManagedBinary(runCargoBuild(sourceDir));
    process.exit(0);
  }
}

throw new Error(
  [
    "No beads_rust source or binary is available.",
    `Set BR_BINARY to a built ${binaryName}, set BEADS_RUST_DIR/BR_SOURCE_DIR to a beads_rust checkout,`,
    `or vendor beads_rust at ${bundledRigDir}.`,
  ].join(" "),
);
