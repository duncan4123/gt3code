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

Use the browser origin for authenticated T3 checks. In Vite dev mode this is
usually `http://localhost:5733`; the backend is still `http://localhost:3773`,
but the app redirects/proxies browser requests through the Vite origin.

```bash
T3_URL=http://localhost:5733
agent-browser --session sidebar-audit open "$T3_URL/"
cat <<'EOF' | agent-browser --session sidebar-audit eval --stdin
(async () => {
  const response = await fetch("/api/auth/dev/session", { method: "POST" });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
})();
EOF
agent-browser --session sidebar-audit open "$T3_URL/"
agent-browser --session sidebar-audit wait --load networkidle
```

Do not rely on `agent-browser --headers` for the SPA. Pairing tokens are
single-use. The dev session endpoint above is loopback-only and must be served
by the already-running T3 backend, so it does not open or lock the app database
from a second process.

## Common Checks

```bash
agent-browser --session sidebar-audit wait 5000
agent-browser --session sidebar-audit snapshot -c -d 8
agent-browser --session sidebar-audit get text body
agent-browser --session sidebar-audit screenshot /tmp/t3-sidebar.png
agent-browser --session sidebar-audit network requests --filter "$T3_URL"
agent-browser --session sidebar-audit console
agent-browser --session sidebar-audit errors
```

## Rules

- Treat a blank page, empty snapshot, or `Failed to fetch` as failed preflight,
  not as a UI result.
- Treat `/pair` after auth setup as a failed auth preflight.
- Capture network requests, console output, and errors before changing app code.
- After using a pairing token, assume it is spent. Issue a fresh bearer token
  for a new authenticated browser session.
- For sidebar audits, compare rendered rows to resolved Gas City config, not
  only to live sessions.
- Check `docs/gc-sidebar-live-audit.md` for the current T3 sidebar audit flow.
