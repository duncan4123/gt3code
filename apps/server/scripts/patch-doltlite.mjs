#!/usr/bin/env node
/**
 * Patches better-sqlite3 to link against libdoltlite.a instead of the
 * standard SQLite amalgamation, then rebuilds the native addon.
 *
 * Runs automatically as a postinstall script. Set DOLTLITE_BUILD_DIR to
 * override the default path to the doltlite build directory.
 *
 * Skips silently if libdoltlite.a is not found (CI / plain SQLite installs).
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = resolve(fileURLToPath(import.meta.url), "../..");
const nodeModulesDir = join(serverDir, "node_modules");

// ── 1. Locate libdoltlite.a ──────────────────────────────────────────────────

const doltliteRoot = process.env.DOLTLITE_BUILD_DIR ?? "/data/projects/doltlite";
const libPath = existsSync(join(doltliteRoot, "libdoltlite.a"))
  ? join(doltliteRoot, "libdoltlite.a")
  : join(doltliteRoot, "build", "libdoltlite.a");

if (!existsSync(libPath)) {
  console.log(`[patch-doltlite] libdoltlite.a not found at ${libPath} — skipping.`);
  console.log("[patch-doltlite] Set DOLTLITE_BUILD_DIR to enable doltlite support.");
  process.exit(0);
}

console.log(`[patch-doltlite] Found libdoltlite.a at ${libPath}`);

// ── 2. Find better-sqlite3 in bun's module cache ────────────────────────────

function findBetterSqlite3(base) {
  // bun stores packages at node_modules/.bun/better-sqlite3@<version>/node_modules/better-sqlite3
  const bunCache = join(base, ".bun");
  if (existsSync(bunCache)) {
    const entries = readdirSync(bunCache).filter((e) => e.startsWith("better-sqlite3@"));
    if (entries.length > 0) {
      return join(bunCache, entries[0], "node_modules", "better-sqlite3");
    }
  }
  // Fallback: regular node_modules
  const plain = join(base, "better-sqlite3");
  if (existsSync(plain)) return plain;
  return null;
}

const pkgDir = findBetterSqlite3(nodeModulesDir);
if (!pkgDir) {
  console.error("[patch-doltlite] Could not find better-sqlite3 in node_modules — aborting.");
  process.exit(1);
}

console.log(`[patch-doltlite] Patching ${pkgDir}`);

// ── 3. Write patched deps/sqlite3.gyp ───────────────────────────────────────

const gypPath = join(pkgDir, "deps", "sqlite3.gyp");
const patchedGyp = `\
# ===
# Doltlite override: link against pre-built libdoltlite.a instead of
# compiling the SQLite amalgamation. The prolly tree engine, dolt functions,
# and FTS5 are all included in the static library.
# ===

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

// ── 4. Check if rebuild is needed (avoid redundant rebuilds) ─────────────────

const addonPath = join(pkgDir, "build", "Release", "better_sqlite3.node");
if (existsSync(addonPath)) {
  // Quick check: if the addon links against libdoltlite, skip rebuild.
  try {
    const symbols = execSync(`nm "${addonPath}" 2>/dev/null | head -1`, { encoding: "utf8" });
    if (symbols.trim()) {
      // Verify doltlite_engine is present by doing a quick runtime check
      try {
        const result = execSync(
          `node --input-type=module <<'EOF'\nimport { createRequire } from 'node:module';\nconst r = createRequire('${pkgDir}/package.json');\nconst db = new (r('./'))(':memory:');\ntry { const v = db.prepare("SELECT doltlite_engine() as e").get(); console.log(v.e); } catch(e) { console.log('missing'); }\ndb.close();\nEOF`,
          { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
        ).trim();
        if (result === "prolly") {
          // Check if libdoltlite.a is newer than the addon — force rebuild if so
          const addonMtime = statSync(addonPath).mtimeMs;
          const libMtime = statSync(libPath).mtimeMs;
          if (libMtime > addonMtime) {
            console.log("[patch-doltlite] libdoltlite.a is newer than addon — rebuilding.");
          } else {
            console.log(
              "[patch-doltlite] Addon already linked against doltlite — skipping rebuild.",
            );
            // Ensure version file exists even when skipping rebuild
            try {
              const versionFile = join(pkgDir, "build", "Release", ".doltlite-version");
              if (!existsSync(versionFile)) {
                const gitHash = execSync("git rev-parse --short HEAD", {
                  cwd: doltliteBuildDir.replace("/build", ""),
                  encoding: "utf8",
                }).trim();
                writeFileSync(
                  versionFile,
                  JSON.stringify({
                    commit: gitHash,
                    libBuilt: new Date(libMtime).toISOString(),
                    addonBuilt: new Date(addonMtime).toISOString(),
                  }) + "\n",
                );
                console.log(`[patch-doltlite] Recorded doltlite version: ${gitHash}`);
              }
            } catch {}
            process.exit(0);
          }
        }
      } catch {
        // Fall through to rebuild
      }
    }
  } catch {
    // Fall through to rebuild
  }
}

// ── 5. Rebuild ───────────────────────────────────────────────────────────────

console.log("[patch-doltlite] Rebuilding better-sqlite3 against libdoltlite.a ...");
try {
  execSync("node-gyp rebuild", {
    cwd: pkgDir,
    stdio: "inherit",
    env: { ...process.env, npm_config_nodedir: undefined },
  });
  console.log("[patch-doltlite] Rebuild complete.");

  // Record doltlite version for runtime verification
  try {
    const gitHash = execSync("git rev-parse --short HEAD", {
      cwd: doltliteBuildDir.replace("/build", ""),
      encoding: "utf8",
    }).trim();
    const libMtime = new Date(
      execSync(`stat -c %Y "${libPath}"`, { encoding: "utf8" }).trim() * 1000,
    ).toISOString();
    writeFileSync(
      join(pkgDir, "build", "Release", ".doltlite-version"),
      JSON.stringify({
        commit: gitHash,
        libBuilt: libMtime,
        addonBuilt: new Date().toISOString(),
      }) + "\n",
    );
    console.log(`[patch-doltlite] Recorded doltlite version: ${gitHash}`);
  } catch {
    console.log("[patch-doltlite] Could not record doltlite version (non-fatal).");
  }
} catch (err) {
  console.error("[patch-doltlite] Rebuild failed:", err.message);
  console.error("[patch-doltlite] Install node-gyp: npm i -g node-gyp");
  process.exit(1);
}
