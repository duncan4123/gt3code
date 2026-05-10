---
name: agent-browser
description: >
  Browser automation CLI for AI agents. Use when a task needs opening or testing a web
  app, clicking through UI, taking screenshots, collecting accessibility snapshots,
  debugging console/network/errors, or verifying T3 sidebar and Gas City UI behavior.
---

# Agent Browser

Use `agent-browser` for user-facing browser checks instead of inferring UI state
from code alone.

## T3Code Auth

Prefer the server origin for authenticated T3 checks:

```bash
TOKEN=$(cd /data/projects/t3code/apps/server && node src/bin.ts auth session issue --role owner --token-only | tail -n 1)
agent-browser set headers "{\"Authorization\":\"Bearer ${TOKEN}\"}"
agent-browser navigate http://localhost:3773/
```

Use the Vite origin only when the task specifically needs Vite source behavior.

## Common Checks

```bash
agent-browser wait 5000
agent-browser snapshot -c -d 8
agent-browser get text body
agent-browser screenshot /tmp/t3-sidebar.png
agent-browser network requests --filter http://localhost:3773
agent-browser console
agent-browser errors
```

## Rules

- Treat a blank page, empty snapshot, or `Failed to fetch` as failed preflight,
  not as a UI result.
- Capture network requests, console output, and errors before changing app code.
- After using a pairing token, assume it is spent. Issue a fresh bearer token
  for a new authenticated browser session.
- For sidebar audits, compare rendered rows to resolved Gas City config, not
  only to live sessions.
- Check `docs/gc-sidebar-live-audit.md` for the current T3 sidebar audit flow.
