import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type RelatedBranch = {
  name: string;
  repo: string;
  role: string;
  pr?: string;
};

type Manifest = {
  name: string;
  path: string;
  sourceRepo: string;
  remote: string;
  syncedBranch: string;
  syncedCommit?: string;
  upstreamRepo?: string;
  upstreamBranch?: string;
  relatedBranches?: Array<RelatedBranch>;
  exclude?: Array<string>;
};

type Entry = {
  kind: "file" | "dir" | "symlink";
  hash?: string;
  target?: string;
};

const repoRoot = process.cwd();
const command = process.argv[2] ?? "check";
const selectedNames = new Set(process.argv.slice(3));

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function findManifests(): Array<string> {
  const packagesDir = path.join(repoRoot, "packages");
  return readdirSync(packagesDir)
    .map((name) => path.join(packagesDir, name, "source.sync.json"))
    .filter((file) => existsSync(file));
}

function loadManifest(file: string): Manifest {
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

function shouldSkip(relativePath: string, excludes: Array<string>): boolean {
  return excludes.some((exclude) => {
    if (exclude.endsWith("*")) {
      const prefix = exclude.slice(0, -1);
      return relativePath.startsWith(prefix);
    }
    return relativePath === exclude || relativePath.startsWith(`${exclude}/`);
  });
}

function materializeSource(manifest: Manifest, destination: string): string {
  const ref = manifest.syncedBranch;
  const commit = execFileSync("git", ["-C", manifest.sourceRepo, "rev-parse", "--short", ref], {
    encoding: "utf8",
  }).trim();
  execFileSync("sh", [
    "-lc",
    `git -C ${shellQuote(manifest.sourceRepo)} archive --format=tar ${shellQuote(ref)} | tar -xf - -C ${shellQuote(destination)}`,
  ]);
  return commit;
}

function assertCleanGitWorktree(repo: string): void {
  const status = execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).trim();
  if (status) {
    throw new Error(`Refusing to export into dirty repo ${repo}. Commit, stash, or clean it first.`);
  }
}

function hashFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function collectEntries(root: string, excludes: Array<string>, prefix = ""): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const name of readdirSync(path.join(root, prefix))) {
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (shouldSkip(relativePath, excludes)) continue;

    const fullPath = path.join(root, relativePath);
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      entries.set(relativePath, { kind: "symlink", target: readlinkSync(fullPath) });
      continue;
    }
    if (stat.isDirectory()) {
      entries.set(relativePath, { kind: "dir" });
      for (const [childPath, childEntry] of collectEntries(root, excludes, relativePath)) {
        entries.set(childPath, childEntry);
      }
      continue;
    }
    if (stat.isFile()) {
      entries.set(relativePath, { kind: "file", hash: hashFile(fullPath) });
    }
  }
  return entries;
}

function compareDirs(left: string, right: string, excludes: Array<string>): Array<string> {
  const leftEntries = collectEntries(left, excludes);
  const rightEntries = collectEntries(right, excludes);
  const paths = new Set([...leftEntries.keys(), ...rightEntries.keys()]);
  const changed: Array<string> = [];

  for (const relativePath of [...paths].sort()) {
    const leftEntry = leftEntries.get(relativePath);
    const rightEntry = rightEntries.get(relativePath);
    if (!leftEntry) {
      changed.push(`missing in package: ${relativePath}`);
      continue;
    }
    if (!rightEntry) {
      changed.push(`extra in package: ${relativePath}`);
      continue;
    }
    if (
      leftEntry.kind !== rightEntry.kind ||
      leftEntry.hash !== rightEntry.hash ||
      leftEntry.target !== rightEntry.target
    ) {
      changed.push(`changed: ${relativePath}`);
    }
  }

  return changed;
}

function copyDir(source: string, destination: string, excludes: Array<string>, prefix = ""): void {
  mkdirSync(path.join(destination, prefix), { recursive: true });
  for (const name of readdirSync(path.join(source, prefix))) {
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (shouldSkip(relativePath, excludes)) continue;

    const sourcePath = path.join(source, relativePath);
    const destinationPath = path.join(destination, relativePath);
    const stat = lstatSync(sourcePath);
    if (stat.isDirectory()) {
      copyDir(source, destination, excludes, relativePath);
    } else if (stat.isSymbolicLink()) {
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      symlinkSync(readlinkSync(sourcePath), destinationPath);
    } else if (stat.isFile()) {
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
  }
}

function emptyDirContents(directory: string, excludes: Array<string>): void {
  for (const name of readdirSync(directory)) {
    if (shouldSkip(name, excludes)) continue;
    rmSync(path.join(directory, name), { recursive: true, force: true });
  }
}

function runForManifest(manifest: Manifest): boolean {
  const excludes = [".git", ".jj", ...(manifest.exclude ?? [])];
  const packagePath = path.resolve(repoRoot, manifest.path);
  const tempRoot = mkdtempSync(path.join(tmpdir(), `t3-${manifest.name}-sync-`));
  const sourcePath = path.join(tempRoot, "source");
  mkdirSync(sourcePath);

  try {
    const actualCommit = materializeSource(manifest, sourcePath);
    const changed = compareDirs(packagePath, sourcePath, excludes);
    const drift = changed.length > 0;

    if (command === "pull") {
      rmSync(packagePath, { recursive: true, force: true });
      mkdirSync(packagePath, { recursive: true });
      copyDir(sourcePath, packagePath, excludes);
      console.log(`${manifest.name}: pulled ${manifest.syncedBranch}@${actualCommit} into ${manifest.path}`);
      return true;
    }

    if (command === "export") {
      assertCleanGitWorktree(manifest.sourceRepo);
      const exportedChanged = compareDirs(manifest.sourceRepo, packagePath, excludes);
      if (exportedChanged.length === 0) {
        console.log(`${manifest.name}: no package changes to export`);
        return true;
      }

      emptyDirContents(manifest.sourceRepo, [".git", ".jj", ...(manifest.exclude ?? [])]);
      mkdirSync(manifest.sourceRepo, { recursive: true });
      copyDir(packagePath, manifest.sourceRepo, excludes);
      console.log(`${manifest.name}: exported package source into ${manifest.sourceRepo}`);
      console.log("  review with:");
      console.log(`  git -C ${manifest.sourceRepo} diff --stat`);
      return true;
    }

    console.log(`${manifest.name}: ${drift ? "drift" : "ok"} (${manifest.syncedBranch}@${actualCommit})`);
    if (manifest.syncedCommit && manifest.syncedCommit !== actualCommit) {
      console.log(`  note: manifest commit is ${manifest.syncedCommit}, branch currently resolves to ${actualCommit}`);
    }
    if (command === "diff" || drift) {
      for (const line of changed.slice(0, 80)) {
        console.log(`  ${line}`);
      }
      if (changed.length > 80) {
        console.log(`  ... ${changed.length - 80} more`);
      }
    }
    return !drift;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (!["check", "diff", "pull", "export"].includes(command)) {
  console.error("Usage: node scripts/package-source-sync.ts [check|diff|pull|export] [package-name...]");
  process.exit(2);
}

const manifests = findManifests()
  .map(loadManifest)
  .filter((manifest) => selectedNames.size === 0 || selectedNames.has(manifest.name));

if (manifests.length === 0) {
  console.error("No package source sync manifests matched.");
  process.exit(2);
}

const ok = manifests.map(runForManifest).every(Boolean);
process.exit(ok ? 0 : 1);
