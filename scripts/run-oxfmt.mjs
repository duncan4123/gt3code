import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const oxfmtBin = resolve(rootDir, "node_modules/oxfmt/bin/oxfmt");
const bunBinDir = resolve(process.env.HOME ?? "", ".bun", "bin");

const isBunNodeShim = (binaryPath) =>
  binaryPath.includes(`${bunBinDir}/`) ||
  binaryPath.endsWith("/.bun/bin/node") ||
  binaryPath.endsWith("\\.bun\\bin\\node.exe") ||
  binaryPath.endsWith("/.bun/bin/bun") ||
  binaryPath.endsWith("\\.bun\\bin\\bun.exe");

const readCommandOutput = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) return [];

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
};

const resolveNodeBinary = () => {
  if (process.env.NODE_BINARY && existsSync(process.env.NODE_BINARY)) {
    return process.env.NODE_BINARY;
  }

  if (!process.versions.bun && !isBunNodeShim(process.execPath)) {
    return process.execPath;
  }

  const candidates = [
    "/usr/bin/node",
    "/usr/local/bin/node",
    ...readCommandOutput("which", ["-a", "node"]),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && !isBunNodeShim(candidate)) {
      return candidate;
    }
  }

  return null;
};

const nodeBinary = resolveNodeBinary();

if (!nodeBinary) {
  console.error("Unable to locate a real Node.js binary for oxfmt. Set NODE_BINARY to continue.");
  process.exit(1);
}

const result = spawnSync(nodeBinary, [oxfmtBin, ...process.argv.slice(2)], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
