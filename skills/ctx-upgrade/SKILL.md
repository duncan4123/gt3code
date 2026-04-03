---
name: ctx-upgrade
description: |
  Update context-mode from GitHub and fix hooks/settings.
  Pulls latest, builds, installs, updates npm global, configures hooks.
  Trigger: /context-mode:ctx-upgrade
user-invocable: true
---

# Context Mode Upgrade

Pull latest from GitHub and reinstall the plugin.

## Instructions

Try each step in order. Move to the next only if the current step fails.

### Step 1: MCP tool (fastest — server is healthy)

1. Call the `ctx_upgrade` MCP tool directly. It returns a shell command.
2. Run the returned command using Bash.
3. Skip to **Display Results**.

### Step 2: CLI fallback (MCP down, binary works)

If the MCP tool call fails, derive the **plugin root** from this skill file's
path (go up 2 levels — remove `/skills/ctx-upgrade`), then:

```bash
CLI="<PLUGIN_ROOT>/cli.bundle.mjs"; [ ! -f "$CLI" ] && CLI="<PLUGIN_ROOT>/build/cli.js"; node "$CLI" upgrade
```

If this succeeds, skip to **Display Results**.

### Step 3: Raw rebuild (everything broken — ABI mismatch, binary corrupted)

If both Step 1 and Step 2 fail, the native addon is likely broken. Run this
**single Bash command** (substitute `<PLUGIN_ROOT>` with the resolved path):

```bash
cd <PLUGIN_ROOT> && git pull origin main 2>&1 && npm install --ignore-scripts 2>&1 && node scripts/patch-doltlite.mjs 2>&1 && npx tsc 2>&1 && npm run bundle 2>&1
```

If `patch-doltlite.mjs` fails (e.g. libdoltlite.a not found), fall back to:

```bash
cd <PLUGIN_ROOT> && npm rebuild better-sqlite3 2>&1
```

Then re-run the build:

```bash
cd <PLUGIN_ROOT> && npx tsc 2>&1 && npm run bundle 2>&1
```

### Display Results

Show a markdown checklist:
```
## context-mode upgrade
- [x] Pulled latest from GitHub
- [x] Built and installed v1.0.XX
- [x] Native addon rebuilt (if applicable)
- [x] Hooks configured
```
Use `[x]` for success, `[ ]` for failure. Show actual version numbers.

Read `<PLUGIN_ROOT>/package.json` to get the installed version.

**Always tell the user to restart their session** to pick up the new MCP server.
