#!/usr/bin/env node
/**
 * Patches better-sqlite3 to link against libdoltlite.a instead of the
 * standard SQLite amalgamation, then rebuilds the native addon.
 *
 * Works for both:
 *   - Development: patches node_modules in the repo
 *   - Installed plugin: patches the Claude marketplace plugin cache
 *
 * Set DOLTLITE_BUILD_DIR to override the default path to the doltlite build directory.
 * Skips silently if libdoltlite.a is not found (CI / plain SQLite installs).
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const scriptDir = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = resolve(scriptDir, "..");

// ── 1. Locate libdoltlite.a ──────────────────────────────────────────────────

const doltliteRoot = process.env.DOLTLITE_BUILD_DIR ?? "/data/projects/doltlite";
// libdoltlite.a lives in the project root; sqlite3.h in build/ after configure.
const libPath = existsSync(join(doltliteRoot, "libdoltlite.a"))
  ? join(doltliteRoot, "libdoltlite.a")
  : join(doltliteRoot, "build", "libdoltlite.a");
const headerPath = existsSync(join(doltliteRoot, "build", "sqlite3.h"))
  ? join(doltliteRoot, "build", "sqlite3.h")
  : join(doltliteRoot, "sqlite3.h");

if (!existsSync(libPath)) {
  console.log(`[patch-doltlite] libdoltlite.a not found at ${libPath} — skipping.`);
  console.log("[patch-doltlite] Set DOLTLITE_BUILD_DIR to enable doltlite support.");
  process.exit(0);
}

if (!existsSync(headerPath)) {
  console.log(`[patch-doltlite] sqlite3.h not found at ${headerPath} — skipping.`);
  console.log("[patch-doltlite] Run: cp /data/projects/doltlite/sqlite3.h /data/projects/doltlite/build/");
  process.exit(0);
}

console.log(`[patch-doltlite] Found libdoltlite.a at ${libPath}`);

// ── 2. Find better-sqlite3 ──────────────────────────────────────────────────

function findBetterSqlite3(base) {
  if (!existsSync(base)) return null;

  // npm flat layout
  const plain = join(base, "better-sqlite3");
  if (existsSync(join(plain, "package.json"))) return plain;

  // bun cache layout
  const bunCache = join(base, ".bun");
  if (existsSync(bunCache)) {
    const entries = readdirSync(bunCache).filter((e) => e.startsWith("better-sqlite3@"));
    if (entries.length > 0) {
      const nested = join(bunCache, entries[0], "node_modules", "better-sqlite3");
      if (existsSync(join(nested, "package.json"))) return nested;
    }
  }

  return null;
}

// Search locations in priority order
const searchPaths = [
  // Development: repo node_modules
  join(repoRoot, "node_modules"),
  // Installed plugin: Claude marketplace (both context-mode and context-mode-doltlite)
  join(homedir(), ".claude", "plugins", "marketplaces", "context-mode-doltlite", "node_modules"),
  join(homedir(), ".claude", "plugins", "marketplaces", "context-mode", "node_modules"),
  // Installed plugin: Claude marketplace cache (find latest version)
  ...(() => {
    const cacheBase = join(homedir(), ".claude", "plugins", "cache", "context-mode", "context-mode");
    if (!existsSync(cacheBase)) return [];
    try {
      return readdirSync(cacheBase)
        .filter((e) => !e.startsWith("."))
        .map((ver) => join(cacheBase, ver, "node_modules"));
    } catch {
      return [];
    }
  })(),
];

let pkgDir = null;
for (const searchPath of searchPaths) {
  pkgDir = findBetterSqlite3(searchPath);
  if (pkgDir) break;
}

if (!pkgDir) {
  console.error("[patch-doltlite] Could not find better-sqlite3 — aborting.");
  process.exit(1);
}

console.log(`[patch-doltlite] Patching ${pkgDir}`);

// ── 2b. Ensure source files exist (prebuilt installs strip them) ────────────

const bindingGyp = join(pkgDir, "binding.gyp");
const srcDir = join(pkgDir, "src");
const depsDir = join(pkgDir, "deps");

if (!existsSync(bindingGyp) || !existsSync(srcDir)) {
  console.log("[patch-doltlite] Source files missing (prebuilt install). Reinstalling from source...");
  const parentDir = join(pkgDir, "..");
  try {
    execSync(`"${process.execPath}" -e "require('child_process').execSync('npm install better-sqlite3 --build-from-source --ignore-scripts', {cwd: '${parentDir.replace(/'/g, "\\'")}', stdio: 'inherit'})"`, {
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch {
    // Fallback: npm pack + extract to get source files
    console.log("[patch-doltlite] --build-from-source failed, trying npm pack...");
    execSync(`cd "${pkgDir}" && npm pack better-sqlite3 --pack-destination /tmp && tar -xzf /tmp/better-sqlite3-*.tgz -C /tmp && cp -r /tmp/package/binding.gyp /tmp/package/src /tmp/package/deps . 2>/dev/null; rm -rf /tmp/better-sqlite3-*.tgz /tmp/package`, {
      stdio: "inherit",
      timeout: 60_000,
      shell: true,
    });
  }
  if (!existsSync(bindingGyp)) {
    console.error("[patch-doltlite] Still no binding.gyp after reinstall — aborting.");
    process.exit(1);
  }
}

if (!existsSync(depsDir)) {
  mkdirSync(depsDir, { recursive: true });
}

// ── 3. Write patched deps/sqlite3.gyp ───────────────────────────────────────

const gypPath = join(pkgDir, "deps", "sqlite3.gyp");
const doltliteBuildDir = resolve(headerPath, "..");
const patchedGyp = `\
{
  'includes': ['common.gypi'],
  'targets': [
    {
      'target_name': 'locate_sqlite3',
      'type': 'none',
    },
    {
      'target_name': 'sqlite3',
      'type': 'none',
      'dependencies': ['locate_sqlite3'],
      'direct_dependent_settings': {
        'include_dirs': ['${doltliteBuildDir}/'],
        'libraries': [
          '${libPath}',
          '-lz',
          '-lpthread',
        ],
      },
    },
  ],
}
`;

writeFileSync(gypPath, patchedGyp);
console.log("[patch-doltlite] Wrote patched deps/sqlite3.gyp");

// ── 4. Check if rebuild is needed ────────────────────────────────────────────

const addonPath = join(pkgDir, "build", "Release", "better_sqlite3.node");
if (existsSync(addonPath)) {
  try {
    const result = execSync(
      `"${process.execPath}" -e "const DB=require('${pkgDir}'); const db=new DB(':memory:'); try{const v=db.prepare('SELECT doltlite_engine() as e').get(); console.log(v.e)}catch(e){console.log('missing')}; db.close();"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (result === "prolly") {
      console.log("[patch-doltlite] Addon already linked against doltlite — skipping rebuild.");
      process.exit(0);
    }
  } catch {
    // Fall through to rebuild
  }
}

// ── 5. Rebuild ───────────────────────────────────────────────────────────────

console.log(`[patch-doltlite] Rebuilding better-sqlite3 against libdoltlite.a (${process.execPath}) ...`);
try {
  // Try multiple ways to find node-gyp, using process.execPath to ensure
  // it builds for the correct Node ABI (not whatever's on PATH).
  const nodeGypPaths = [
    join(pkgDir, "node_modules", ".bin", "node-gyp"),
    join(repoRoot, "node_modules", ".bin", "node-gyp"),
  ];
  let nodeGypBin = nodeGypPaths.find((p) => existsSync(p));
  const rebuildCmd = nodeGypBin
    ? `"${process.execPath}" "${nodeGypBin}" rebuild`
    : `"${process.execPath}" -e "require('child_process').execSync('npx node-gyp rebuild', {cwd:'${pkgDir.replace(/'/g, "\\'")}', stdio:'inherit', env:{...process.env, npm_config_nodedir:undefined}})"`;
  execSync(rebuildCmd, {
    cwd: pkgDir,
    stdio: "inherit",
    env: { ...process.env, npm_config_nodedir: undefined },
    shell: true,
  });
  console.log("[patch-doltlite] Rebuild complete.");
} catch (err) {
  // Check if the main addon was built (test_extension failure is OK)
  if (existsSync(addonPath)) {
    console.log("[patch-doltlite] Rebuild complete (test_extension warning is harmless).");
  } else {
    console.error("[patch-doltlite] Rebuild failed:", err.message);
    process.exit(1);
  }
}

// ── 6. Verify ────────────────────────────────────────────────────────────────

try {
  const result = execSync(
    `"${process.execPath}" -e "const DB=require('${pkgDir}'); const db=new DB(':memory:'); console.log(db.prepare('SELECT doltlite_engine() as e').get().e); db.close();"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
  if (result === "prolly") {
    console.log("[patch-doltlite] Verified: doltlite_engine() = prolly");
  } else {
    console.warn("[patch-doltlite] Warning: doltlite_engine() returned:", result);
  }
} catch (err) {
  console.warn("[patch-doltlite] Warning: verification failed:", err.message);
}
