#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const workspaceRoot = resolve(scriptDir, "..");
const rootPackageJson = readJson(join(workspaceRoot, "package.json"));
const scriptsPackageJson = readJson(join(scriptDir, "package.json"));
const bunStoreDir = join(workspaceRoot, "node_modules", ".bun");

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

function resolvePackageVersion(packageName: string, spec: string): string | undefined {
  if (spec === "catalog:") {
    return rootPackageJson.workspaces?.catalog?.[packageName];
  }

  const exactMatch = spec.match(/^\^?(\d+\.[^ ]*)$/);
  return exactMatch?.[1];
}

function bunStorePrefixForPackage(packageName: string): string {
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.split("/");
    return `${scope}+${name}@`;
  }

  return `${packageName}@`;
}

function findBunStoreEntry(packageName: string, version: string | undefined): string | undefined {
  const prefix = bunStorePrefixForPackage(packageName);
  const entries = readdirSync(bunStoreDir)
    .filter((entry) => entry.startsWith(prefix))
    .sort()
    .reverse();

  if (version !== undefined) {
    const versionedPrefix = `${prefix}${version}`;
    const exactVersion = entries.find(
      (entry) => entry === versionedPrefix || entry.startsWith(`${versionedPrefix}+`),
    );
    if (exactVersion !== undefined) {
      return exactVersion;
    }
  }

  return entries[0];
}

function packageLinkPath(packageName: string): string {
  return join(workspaceRoot, "node_modules", packageName);
}

function ensureLinkedPackage(packageName: string, spec: string): string | undefined {
  const linkPath = packageLinkPath(packageName);
  if (existsSync(linkPath)) {
    return undefined;
  }

  const version = resolvePackageVersion(packageName, spec);
  const storeEntry = findBunStoreEntry(packageName, version);
  if (storeEntry === undefined) {
    return undefined;
  }

  const packageDir = join(bunStoreDir, storeEntry, "node_modules", packageName);
  if (!existsSync(packageDir)) {
    return undefined;
  }

  const brokenLink = (() => {
    try {
      return lstatSync(linkPath).isSymbolicLink();
    } catch {
      return false;
    }
  })();
  if (brokenLink) {
    rmSync(linkPath, { recursive: true, force: true });
  }

  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(relative(dirname(linkPath), packageDir), linkPath, "dir");
  return packageName;
}

function repairWorkspacePackageLinks() {
  if (!existsSync(bunStoreDir)) {
    return [];
  }

  const repaired = new Set<string>();
  for (const manifest of [rootPackageJson, scriptsPackageJson]) {
    for (const section of ["dependencies", "devDependencies"] as const) {
      const deps = manifest[section] as Record<string, string> | undefined;
      if (deps === undefined) {
        continue;
      }

      for (const [packageName, spec] of Object.entries(deps)) {
        if (spec.startsWith("workspace:")) {
          continue;
        }

        const repairedPackage = ensureLinkedPackage(packageName, spec);
        if (repairedPackage !== undefined) {
          repaired.add(repairedPackage);
        }
      }
    }
  }

  if (repaired.size > 0) {
    console.log(`[dev-runner] repaired package links: ${Array.from(repaired).sort().join(", ")}`);
  }
}

repairWorkspacePackageLinks();
process.argv = [process.argv[0]!, scriptPath, ...process.argv.slice(2)];
const { main } = (await import(pathToFileURL(join(scriptDir, "dev-runner.impl.ts")).href)) as {
  readonly main: () => void;
};
main();
