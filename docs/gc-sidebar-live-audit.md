# GC Sidebar Live Audit

Use formula `mol-t3-sidebar-live-audit` to test the T3Code Gas City sidebar
against a live bundled city.

## Purpose

The audit proves that the sidebar is a correct control surface for live GC
state. It must verify the browser UI, runtime TOML, resolved `gc` config,
session lifecycle, and T3 thread rows as one loop.

## Runtime Files That Matter

- Runtime city: `/home/ubuntu/.local/state/t3code/gascity/current/city`
- Runtime TOML: `/home/ubuntu/.local/state/t3code/gascity/current/city/city.toml`
- Runtime site TOML: `/home/ubuntu/.local/state/t3code/gascity/current/city/.gc/site.toml`
- Source seed: `packages/gascity-config/config`
- Formula: `packages/gascity-config/config/packs/gastown/formulas/mol-t3-sidebar-live-audit.toml`

Do not use source seed files as proof of live behavior. The sidebar must match
the runtime city and `bun gc -- config show`.

## Context-Mode Audit Rule

Use context-mode database `gc-t3code`. Keep one context-mode branch per git
branch. For branch `ship`, use context-mode branch `ship`.

Commit after every meaningful phase:

- Baseline runtime/config/session snapshot.
- Expected inventory snapshot.
- Browser sidebar inventory snapshot.
- Each control-family round trip.
- Session/thread lifecycle checks.
- Final report.

The context-mode commits are the audit trail that proves what changed. If a
control claims to mutate config, the before/after snapshots must show the exact
TOML and resolved config delta.

## User-Facing Test Loop

1. Derive expected agents from `bun gc -- config show`.
2. Open `http://localhost:5733/` with `agent-browser`.
3. Expand the workspace and rig folders in the sidebar.
4. Compare each visible row and control against resolved GC config.
5. Click one control at a time.
6. Verify browser state, `city.toml`, `bun gc -- config show`, `bun gc -- status`,
   and `bun gc -- session list`.
7. Restore the original value before moving to the next control.

## Browser Preflight

Before trusting browser evidence, prove the browser is attached to the real app:

```bash
agent-browser close --all
agent-browser --session sidebar-audit open http://localhost:5733/
agent-browser --session sidebar-audit wait 5000
agent-browser --session sidebar-audit get url
agent-browser --session sidebar-audit eval 'JSON.stringify({url:location.href,title:document.title,bodyText:document.body.innerText.slice(0,500),rootHtmlLength:document.getElementById("root")?.innerHTML.length ?? -1,scriptCount:document.scripts.length})'
agent-browser --session sidebar-audit snapshot
agent-browser --session sidebar-audit screenshot /tmp/t3-sidebar-audit-baseline.png
```

Do not continue if the URL is `about:blank`, the root is empty, the snapshot is
empty, or the screenshot is blank. Capture network requests, console, and page
errors, then fix browser/session setup first.

### Authenticated Agent-Browser Setup

When T3 is running in authenticated web mode, the pairing page can mislead an
audit:

- Pairing tokens are one-time tokens.
- Navigating to a new `/pair#token=...` URL can leave the old token mounted in
  the React component until a full reload.
- A blank `http://localhost:5733/` page with repeated
  `GET /api/auth/session` requests means the browser is not authenticated; it is
  not sidebar evidence.

For a reliable live-sidebar inspection in Vite dev mode, issue a bearer session
from the same server process state and install it as a browser-origin cookie.
The `--dev-url` value must match the running Vite origin or the token is minted
against the wrong state DB:

```bash
T3_URL=http://localhost:5733
T3_HOME=/home/ubuntu/.t3
TOKEN=$(
  cd /data/projects/t3code/apps/server &&
    T3CODE_HOME="$T3_HOME" VITE_DEV_SERVER_URL="$T3_URL" \
    node src/bin.ts auth session issue --dev-url "$T3_URL" --role owner --token-only \
      2>/tmp/t3-agent-browser-auth.err |
    sed '/^$/d' |
    tail -n 1
)

agent-browser --session sidebar-audit cookies set t3_session "$TOKEN" \
  --url "$T3_URL/" --path / --sameSite Lax
agent-browser --session sidebar-audit open "$T3_URL/"
agent-browser --session sidebar-audit wait 7000
agent-browser --session sidebar-audit get text body
agent-browser --session sidebar-audit snapshot -c -d 8
```

Do not rely on `agent-browser --headers` for the SPA. Pairing tokens are
single-use; bearer-session cookies are the repeatable audit path. Treat `/pair`
after the cookie setup as an auth preflight failure.

### Reading The Actual Sidebar Tree

The accessibility snapshot is useful for preflight, but it can be empty or miss
the rendered sidebar in this app. If `snapshot` says `(empty page)` or
`(no interactive elements)` while `document.body.innerText` contains sidebar
text, read the rendered DOM rows directly:

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

For visual layout issues, also capture a screenshot:

```bash
agent-browser --session sidebar-audit screenshot /tmp/t3-sidebar-current.png
```

Always close the browser session after the audit:

```bash
agent-browser --session sidebar-audit close
```

Useful diagnostics when the page is blank or auth loops:

```bash
agent-browser --session sidebar-audit network requests --filter "$T3_URL"
agent-browser --session sidebar-audit console
agent-browser --session sidebar-audit errors
tail -n 120 /tmp/t3code-server-setsid.log
```

The expected multicity tree starts under `Cities` and should include configured
items even when no sessions/threads exist:

```text
Cities
  gascity-br
    mayor
    dog
    beads_rust
      control-dispatcher
      polecat
      refinery
      witness
  gastown
    boot
    deacon
    dog
    mayor
    t3code
      control-dispatcher
      polecat
      refinery
      witness
    beads-doltlite
      control-dispatcher
      polecat
      refinery
      witness
    context-mode
      control-dispatcher
      polecat
      refinery
      witness
    gascity
      control-dispatcher
      polecat
      refinery
      witness
    test-rig
      control-dispatcher
      polecat
      refinery
      witness
```

If a city-scoped config API route returns 404, do not assume the city is gone.
Check the registered city list and resolved config:

```bash
GC_HOME=/home/ubuntu/.local/state/t3code/gascity/current \
  /home/ubuntu/.local/state/t3code/gascity/current/bin/gc cities

GC_HOME=/home/ubuntu/.local/state/t3code/gascity/current \
  /home/ubuntu/.local/state/t3code/gascity/current/bin/gc \
  --city /data/projects/t3code/packages/gascity-config/config/cities/gascity-br \
  config show
```

Configured sidebar rows should come from resolved config first; runtime state
only changes labels and controls.

## Known Failure Modes To Catch

- `named_session_mode` is stale, causing `on_demand` agents to display as `auto`.
- CLI-only rigs disappear when the GC API response is stale.
- A runner command overwrites runtime `city.toml` and drops user-added rigs.
- Thread metadata makes a removed rig look configured.
- Pack agents without threads are missing from the sidebar.
- Agent controls mutate the wrong TOML block.
- `site.toml` is rewritten by unrelated actions.

## Minimum Pass Matrix

- Workspace agents with no `dir` appear under the workspace folder.
- Every `[[rigs]]` entry appears as a rig folder.
- Every resolved non-hidden `dir = "<rig>"` agent appears under that rig.
- `always` named sessions show `auto`.
- `on_demand` named sessions show `demand`.
- Suspended state matches resolved config.
- Pool min/max controls appear only for pool agents.
- Suspend/resume, auto/demand, wake mode, and pool-size controls round-trip.
- Sessions/threads are created or resumed only when GC semantics require it.

## Final Report

Write the report to `docs/audits/` or another explicit file. Include the git
commit, context-mode commits, config hashes, screenshots, session IDs, thread
IDs, exact failures, and follow-up beads.
