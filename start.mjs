#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, chmodSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const originalCwd = process.cwd();
process.chdir(__dirname);

if (!process.env.CLAUDE_PROJECT_DIR) {
  process.env.CLAUDE_PROJECT_DIR = originalCwd;
}

// Routing instructions file auto-write DISABLED for all platforms (#158, #164).
// Env vars like CLAUDE_SESSION_ID may not be set at MCP startup time, making
// the hook-capability guard unreliable. Writing to project dirs dirties git trees
// and causes double context injection on hook-capable platforms.
// Routing is handled by:
//   - Hook-capable platforms: SessionStart hook injects ROUTING_BLOCK
//   - Non-hook platforms: server.ts writeRoutingInstructions() on MCP connect
//   - Future: explicit `context-mode-doltlite init` command

// Self-heal: if a newer version dir exists, update registry so next session uses it
const cacheMatch = __dirname.match(
  /^(.*[\/\\]plugins[\/\\]cache[\/\\][^\/\\]+[\/\\][^\/\\]+[\/\\])([^\/\\]+)$/,
);
if (cacheMatch) {
  try {
    const cacheParent = cacheMatch[1];
    const myVersion = cacheMatch[2];
    const dirs = readdirSync(cacheParent).filter((d) =>
      /^\d+\.\d+\.\d+/.test(d),
    );
    if (dirs.length > 1) {
      dirs.sort((a, b) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] ?? 0) !== (pb[i] ?? 0))
            return (pa[i] ?? 0) - (pb[i] ?? 0);
        }
        return 0;
      });
      const newest = dirs[dirs.length - 1];
      if (newest && newest !== myVersion) {
        const ipPath = resolve(
          homedir(),
          ".claude",
          "plugins",
          "installed_plugins.json",
        );
        const ip = JSON.parse(readFileSync(ipPath, "utf-8"));
        for (const [key, entries] of Object.entries(ip.plugins || {})) {
          if (!key.toLowerCase().includes("context-mode-doltlite")) continue;
          for (const entry of entries) {
            entry.installPath = resolve(cacheParent, newest);
            entry.version = newest;
            entry.lastUpdated = new Date().toISOString();
          }
        }
        writeFileSync(
          ipPath,
          JSON.stringify(ip, null, 2) + "\n",
          "utf-8",
        );
      }
    }
  } catch {
    /* best effort — don't block server startup */
  }
}

// Install ABI-matched prebuilt BEFORE anything tries to load better-sqlite3.
// ensure-deps.mjs and server.bundle.mjs both load better-sqlite3, so the
// correct binary must be in place first. Plain SQLite is NOT acceptable.
{
  const { createRequire } = await import("node:module");
  const req = createRequire(resolve(__dirname, "package.json"));
  const abi = process.versions.modules;
  const prebuildSrc = resolve(__dirname, "prebuilds", `${process.platform}-${process.arch}`, `node.abi${abi}.node`);
  const bsqlPkg = resolve(__dirname, "node_modules", "better-sqlite3", "package.json");
  const targetDir = resolve(__dirname, "node_modules", "better-sqlite3", "build", "Release");

  // Step 1: Ensure the full better-sqlite3 npm module exists (not just the binary)
  if (!existsSync(bsqlPkg)) {
    console.error("[start] better-sqlite3 module missing — installing...");
    try {
      execSync("npm install better-sqlite3 --no-package-lock --no-save --ignore-scripts --silent", {
        cwd: __dirname, stdio: "pipe", timeout: 120000,
      });
      console.error("[start] better-sqlite3 module installed.");
    } catch (e) {
      console.error("[start] FATAL: could not install better-sqlite3:", e.message);
      process.exit(1);
    }
  }

  // Step 2: Verify doltlite engine — copy prebuilt if vanilla or wrong ABI
  let needsCopy = false;
  try {
    const DB = req("better-sqlite3");
    const db = new DB(":memory:");
    try {
      const row = db.prepare("SELECT doltlite_engine() AS e").get();
      if (row?.e !== "prolly") needsCopy = true;
    } catch { needsCopy = true; }
    db.close();
  } catch { needsCopy = true; }

  if (needsCopy) {
    if (existsSync(prebuildSrc)) {
      const { mkdirSync: mk, copyFileSync: cp } = await import("node:fs");
      mk(targetDir, { recursive: true });
      cp(prebuildSrc, resolve(targetDir, "better_sqlite3.node"));
      console.error("[start] Installed doltlite prebuilt for " + process.platform + "-" + process.arch + " ABI " + abi);
    } else {
      console.error("[start] FATAL: better-sqlite3 (doltlite) failed to load.");
      console.error("[start] No prebuilt for ABI " + abi + " at " + prebuildSrc);
      process.exit(1);
    }
  }
}

// Ensure native dependencies + ABI compatibility (shared with hooks via ensure-deps.mjs)
// MUST be dynamic import — static imports hoist above the prebuilt probe.
await import("./hooks/ensure-deps.mjs");

// Also install pure-JS deps used by server
for (const pkg of ["turndown", "turndown-plugin-gfm", "@mixmark-io/domino"]) {
  if (!existsSync(resolve(__dirname, "node_modules", pkg))) {
    try {
      execSync(`npm install ${pkg} --no-package-lock --no-save --silent`, {
        cwd: __dirname,
        stdio: "pipe",
        timeout: 120000,
      });
    } catch { /* best effort */ }
  }
}

// Self-heal: create CLI shim if cli.bundle.mjs is missing (marketplace installs)
if (!existsSync(resolve(__dirname, "cli.bundle.mjs")) && existsSync(resolve(__dirname, "build", "cli.js"))) {
  const shimPath = resolve(__dirname, "cli.bundle.mjs");
  writeFileSync(shimPath, '#!/usr/bin/env node\nawait import("./build/cli.js");\n');
  if (process.platform !== "win32") chmodSync(shimPath, 0o755);
}

// Bundle exists (CI-built) — start instantly
if (existsSync(resolve(__dirname, "server.bundle.mjs"))) {
  await import("./server.bundle.mjs");
} else {
  // Dev or npm install — full build
  if (!existsSync(resolve(__dirname, "node_modules"))) {
    try {
      execSync("npm install --silent", { cwd: __dirname, stdio: "pipe", timeout: 60000 });
    } catch { /* best effort */ }
  }
  if (!existsSync(resolve(__dirname, "build", "server.js"))) {
    try {
      execSync("npx tsc --silent", { cwd: __dirname, stdio: "pipe", timeout: 30000 });
    } catch { /* best effort */ }
  }
  await import("./build/server.js");
}
