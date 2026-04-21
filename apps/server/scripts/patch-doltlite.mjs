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

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const serverDir = resolve(fileURLToPath(import.meta.url), "../..");
const workspaceRoot = resolve(serverDir, "..", "..");

// ── 1. Locate libdoltlite.a ──────────────────────────────────────────────────

const doltliteRoot = process.env.DOLTLITE_BUILD_DIR ?? "/data/projects/doltlite";
const libPath = existsSync(join(doltliteRoot, "libdoltlite.a"))
  ? join(doltliteRoot, "libdoltlite.a")
  : join(doltliteRoot, "build", "libdoltlite.a");
const headerDir = existsSync(join(doltliteRoot, "build", "sqlite3.h"))
  ? join(doltliteRoot, "build")
  : doltliteRoot;

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
    try {
      const req = createRequire(join(workspaceRoot, "packages", "doltlite", "package.json"));
      const resolvedPkgJson = req.resolve("better-sqlite3/package.json");
      return resolve(resolvedPkgJson, "..");
    } catch {
      const entries = readdirSync(bunCache)
        .filter((e) => e.startsWith("better-sqlite3@"))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (entries.length > 0) {
        return join(bunCache, entries[0], "node_modules", "better-sqlite3");
      }
    }
  }
  // Fallback: regular node_modules
  const plain = join(base, "better-sqlite3");
  if (existsSync(plain)) return plain;
  return null;
}

const pkgDir =
  findBetterSqlite3(join(workspaceRoot, "node_modules")) ??
  findBetterSqlite3(join(serverDir, "node_modules"));
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
      'type': 'static_library',
      'dependencies': ['locate_sqlite3'],
      'sources': ['doltlite_stubs.c'],
      'direct_dependent_settings': {
        'include_dirs': ['${headerDir}', 'sqlite3'],
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

// Write stub implementations for symbols that older libdoltlite builds
// do not provide. Newer builds may export these directly.
const stubsPath = join(pkgDir, "deps", "doltlite_stubs.c");
let needsColumnMetadataStubs = true;
try {
  const exportedSymbols = execSync(`nm ${JSON.stringify(libPath)}`, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  needsColumnMetadataStubs = !exportedSymbols.includes("sqlite3_column_origin_name");
} catch {
  // Fall back to conservative behavior if symbol inspection fails.
}
writeFileSync(
  stubsPath,
  needsColumnMetadataStubs
    ? `\
/* Stubs for SQLITE_ENABLE_COLUMN_METADATA symbols missing from libdoltlite.a.
   Return NULL = "no metadata". */
const char *sqlite3_column_origin_name(void *stmt, int col) { return 0; }
const void *sqlite3_column_origin_name16(void *stmt, int col) { return 0; }
const char *sqlite3_column_table_name(void *stmt, int col) { return 0; }
const void *sqlite3_column_table_name16(void *stmt, int col) { return 0; }
const char *sqlite3_column_database_name(void *stmt, int col) { return 0; }
const void *sqlite3_column_database_name16(void *stmt, int col) { return 0; }
`
    : "/* Column metadata symbols provided by libdoltlite.a; no stubs needed. */\n",
);
console.log(
  needsColumnMetadataStubs
    ? "[patch-doltlite] Wrote doltlite_stubs.c (COLUMN_METADATA stubs)"
    : "[patch-doltlite] Wrote doltlite_stubs.c (no stubs needed)",
);
console.log("[patch-doltlite] Wrote patched deps/sqlite3.gyp");

function verifyAddon(pkgDirToCheck) {
  const verifyScript = `
    import { createRequire } from 'node:module';
    const r = createRequire(${JSON.stringify(join(pkgDirToCheck, "package.json"))});
    const db = new (r('./'))(':memory:');
    try {
      const engine = db.prepare("SELECT doltlite_engine() AS e").get()?.e;
      db.exec("CREATE VIRTUAL TABLE __fts5_smoke USING fts5(content)");
      db.exec("DROP TABLE __fts5_smoke");
      console.log(engine === 'prolly' ? 'ok' : 'missing-engine');
    } catch (error) {
      console.log(String(error?.message ?? error));
    } finally {
      db.close();
    }
  `;
  return execFileSync(process.execPath, ["--input-type=module", "-e", verifyScript], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

// ── 4. Check if rebuild is needed (avoid redundant rebuilds) ─────────────────

const addonPath = join(pkgDir, "build", "Release", "better_sqlite3.node");
if (existsSync(addonPath)) {
  // Quick check: if the addon links against libdoltlite, skip rebuild.
  try {
    const symbols = execSync(`nm "${addonPath}" 2>/dev/null | head -1`, { encoding: "utf8" });
    if (symbols.trim()) {
      // Verify both doltlite and FTS5 support before skipping rebuild.
      try {
        const result = verifyAddon(pkgDir);
        if (result === "ok") {
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
                  cwd: doltliteRoot,
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
  const targetVersion = process.version;
  const nodeGypPaths = [
    join(pkgDir, "node_modules", ".bin", "node-gyp"),
    join(workspaceRoot, "node_modules", ".bin", "node-gyp"),
    join(serverDir, "node_modules", ".bin", "node-gyp"),
  ];
  const nodeGypBin = nodeGypPaths.find((p) => existsSync(p));
  const rebuildCmd = nodeGypBin
    ? `${JSON.stringify(process.execPath)} ${JSON.stringify(nodeGypBin)} rebuild --target=${targetVersion}`
    : `npx node-gyp rebuild --target=${targetVersion}`;
  execSync(rebuildCmd, {
    cwd: pkgDir,
    stdio: "inherit",
    env: { ...process.env, npm_config_nodedir: undefined },
    shell: true,
  });
  console.log("[patch-doltlite] Rebuild complete.");

  const verifyResult = verifyAddon(pkgDir);
  if (verifyResult !== "ok") {
    throw new Error(`addon verification failed: ${verifyResult}`);
  }
  console.log("[patch-doltlite] Verified: doltlite_engine() = prolly; FTS5 available.");

  // Record doltlite version for runtime verification
  try {
    const gitHash = execSync("git rev-parse --short HEAD", {
      cwd: doltliteRoot,
      encoding: "utf8",
    }).trim();
    const libMtime = new Date(statSync(libPath).mtimeMs).toISOString();
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
