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
T3_HOME="${T3CODE_HOME:-$HOME/.t3}"
T3CODE_REPO="${T3CODE_REPO:-$(git rev-parse --show-toplevel)}"
TOKEN=$(cd "$T3CODE_REPO/apps/server" && \
  T3CODE_HOME="$T3_HOME" VITE_DEV_SERVER_URL="$T3_URL" \
  node src/bin.ts auth session issue --dev-url "$T3_URL" --role owner --token-only \
  2>/tmp/t3-agent-browser-auth.err | sed '/^$/d' | tail -n 1)
agent-browser --session sidebar-audit cookies set t3_session "$TOKEN" \
  --url "$T3_URL/" --path / --sameSite Lax
agent-browser --session sidebar-audit open "$T3_URL/"
```

Do not rely on `agent-browser --headers` for the SPA. Pairing tokens are
single-use; use the bearer-session cookie flow above for repeatable audits.

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

## Reading The T3 Sidebar

Do not treat an empty accessibility snapshot as proof that the sidebar is empty.
If `get text body` shows sidebar text, extract the rendered rows from the DOM:

```bash
agent-browser --session sidebar-audit eval --stdin <<'EOF'
(() => {
  const norm = (value) => (value || "").replace(/\s+/g, " ").trim();
  return [...document.querySelectorAll('li[data-sidebar="menu-sub-item"]')]
    .map((row) => {
      const rig = row.querySelector(':scope > button[data-testid^="gc-rig-toggle-"]');
      const agent = row.querySelector(':scope > button[data-testid^="gc-agent-folder-toggle-"]');
      const thread = row.getAttribute("data-thread-item");
      const buttons = [...row.querySelectorAll("button")]
        .filter((button) => button.closest('li[data-sidebar="menu-sub-item"]') === row)
        .map((button) => ({
          testid: button.getAttribute("data-testid"),
          text: norm(button.innerText),
          aria: button.getAttribute("aria-label"),
        }));
      if (rig) return { type: "rig-or-city", id: rig.getAttribute("data-testid"), label: norm(rig.innerText), buttons };
      if (agent) return { type: "agent", id: agent.getAttribute("data-testid"), label: norm(agent.innerText), buttons };
      if (thread) return { type: "thread", id: thread, label: norm(row.innerText), buttons };
      return null;
    })
    .filter(Boolean);
})()
EOF
```

Also take a screenshot when checking truncation, overlap, or missing labels.
Close the browser session when done.

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
