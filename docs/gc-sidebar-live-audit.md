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
