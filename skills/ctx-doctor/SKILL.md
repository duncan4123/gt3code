---
name: ctx-doctor
description: |
  Run context-mode diagnostics. Checks runtimes, hooks, FTS5,
  plugin registration, npm and marketplace versions.
  Trigger: /context-mode:ctx-doctor
user-invocable: true
---

# Context Mode Doctor

Run diagnostics and display results directly in the conversation.

## Instructions

Try each step in order. Move to the next only if the current step fails.

### Step 1: MCP tool (fastest — server is healthy)

1. Call the `ctx_doctor` MCP tool directly. It returns a formatted checklist.
2. Display the results verbatim — they use `[x]` PASS, `[ ]` FAIL, `[-]` WARN.

### Step 2: CLI fallback (MCP down, binary works)

If the MCP tool call fails, derive the **plugin root** from this skill file's
path (go up 2 levels — remove `/skills/ctx-doctor`), then:

```bash
CLI="<PLUGIN_ROOT>/cli.bundle.mjs"; [ ! -f "$CLI" ] && CLI="<PLUGIN_ROOT>/build/cli.js"; node "$CLI" doctor
```

Display results as a markdown checklist.

### Step 3: Manual diagnostics (everything broken)

If both Step 1 and Step 2 fail, the native addon is likely broken. Run these
checks manually and report each one:

```bash
# Plugin location
PLUGIN_ROOT="<PLUGIN_ROOT>"
echo "Plugin root: $PLUGIN_ROOT"

# Version
node -e "console.log(JSON.parse(require('fs').readFileSync('$PLUGIN_ROOT/package.json','utf8')).version)" 2>&1

# Node version and ABI
node -e "console.log('Node:', process.version, 'ABI:', process.versions.modules)" 2>&1

# better-sqlite3 native addon
ls -la "$PLUGIN_ROOT/node_modules/better-sqlite3/build/Release/"*.node 2>&1

# Test native addon loads
node -e "const db = require('$PLUGIN_ROOT/node_modules/better-sqlite3')(':memory:'); console.log('SQLite OK'); db.close()" 2>&1

# Test doltlite specifically
node -e "const db = require('$PLUGIN_ROOT/node_modules/better-sqlite3')(':memory:'); try{console.log('doltlite:',db.prepare('SELECT doltlite_engine() as e').get().e)}catch(e){console.log('doltlite: NOT LINKED')}; db.close()" 2>&1

# Git status
cd "$PLUGIN_ROOT" && git log --oneline -3 2>&1
```

Format results as:
```
## context-mode doctor
- [x] Plugin: v1.0.XX at <path>
- [x] Node: v24.X.X (ABI 137)
- [x] Native addon: better_sqlite3.node present
- [x] SQLite: loads OK
- [x] Doltlite: prolly engine active
- [ ] FAIL: <describe any failure>
```

If the native addon fails to load, suggest running `/ctx-upgrade` (Step 3)
to rebuild it.
