---
name: gc-sidebar-forensics
description: >
  Forensic debugging workflow for T3 Code Gas City sidebar controls, TOML
  patches, T3Bridge session startup, and thread visibility. Use when verifying
  that GC sidebar suspend/resume/wake controls correctly patch city.toml and
  that started agents produce visible threads.
---

# GC Sidebar Forensics

Debug one agent at a time. Do not bulk-click controls while investigating.
Every conclusion needs four-way evidence: sidebar UI, `city.toml`, GC API/session
state, and T3Bridge logs/events.

## Browser Hygiene

Use one `agent-browser` session for the investigation. Do not create a new
session for every probe.

Before opening the app, count existing browser automation processes:

```bash
pgrep -fc '/node_modules/agent-browser/bin/agent-browser-linux-x64|/bin/agent-browser '
pgrep -fc '/\.agent-browser/browsers/chrome-|chrome_crashpad_handler'
```

Expected steady state is one active `agent-browser` controller for sidebar
testing. If many stale sessions exist, close or kill the stale sessions before
continuing, then reuse one named session for the rest of the run.

When reporting counts, distinguish the `agent-browser` controller process count
from Chrome child processes. Chrome children can be numerous; they are not
separate sidebar investigations.

## Scope The Agent

Record the exact target before touching anything:

- City, rig, and local agent name.
- Qualified UI name, such as `gastown/gascity/refinery`.
- Expected session name, such as `gascity--refinery` or `gastown__deacon`.
- Whether it is workspace-scoped, rig-scoped, pool, or on-demand.
- Expected thread folder placement in the sidebar.

Use names from resolved config, not assumptions from paths or stale sessions.

## Baseline

1. Capture sidebar text and a screenshot with `agent-browser`.
2. List relevant buttons and aria labels with `agent-browser eval`.
3. Capture browser console and errors before changing anything.
4. Capture `city.toml` around the target.
5. Capture resolved config with `gc config show` or API config.
6. Capture sessions with `gc session list --json`.
7. Capture recent supervisor/T3Bridge logs with `gc supervisor logs -n`.

Never use tmux as evidence for T3Bridge sessions.

## Mutate Through The Sidebar

Use the visible sidebar control only:

- Click `Resume ... in config` for suspended agents.
- Verify `city.toml` changed before clicking wake.
- Click `Wake ...` only after the agent is not config-suspended.
- For on-demand agents, wake should create or reuse one named session.
- For pool agents, verify what the control is expected to do before assuming a
  pool member should exist.

After each click, wait for reconciliation and refresh config/session state.

## Verify TOML Patches

Check the exact file the current city uses. For `gastown` in t3code dev this is:

`packages/gascity-config/config/cities/gastown/city.toml`

Verify:

- Workspace agents patch under `[[patches.agent]]` with `dir = ""` when needed.
- Rig agents patch under `[[patches.agent]] dir = "<rig>"` or the intended rig
  override block, depending on the current code path.
- No duplicate keys are created in a TOML table.
- Existing unrelated rigs and agents are not changed.
- `gc config show` still parses after the patch.

If TOML changes are wrong, fix the code path that wrote them before continuing.

## Verify T3Bridge Startup

Use T3Bridge logs as runtime truth:

- Look for `t3bridge: Start(<session>) called`.
- Confirm provider, model, workdir, projectRoot, agent, and template.
- Confirm `creating thread id=...` or `found existing binding thread=...`.
- Confirm `writing gc metadata`.
- Confirm the API wake route returned 200, or capture the exact 404/error route.

If T3Bridge creates a binding but the sidebar does not show the thread, treat it
as a sidebar visibility/rendering bug, not a startup success.

## Verify Thread Visibility

After startup:

1. Refresh the browser once.
2. If the sidebar briefly says "No projects yet", wait a few seconds and capture
   console/network state before treating it as a failure. The project list can
   repopulate after WebSocket/runtime hydration.
3. Confirm the expected thread row appears under the expected city and rig or
   workspace folder.
4. Confirm the thread is not merely visible somewhere else. Wrong folder
   placement is a sidebar bug even when the thread exists.
5. Confirm the same thread is not duplicated elsewhere.
6. Confirm normal upstream thread row details still render, including title and
   time.
7. Confirm closed/collapsed folders do not leak child rows.

Sidebar rule: if a thread exists, it must be visible. Filtering threads out is
not allowed.

For browser-side API evidence, prefer the app's own local API client instead of
raw SQLite inspection. In agent-browser, dynamic import works in dev:

```js
(async () => {
  const { readLocalApi } = await import("/src/localApi.ts");
  return await readLocalApi().gc.findThreadBinding({ sessionName: "..." });
})();
```

Use this to verify config and bindings through the same path the UI uses.

## Diagnose Failures

If the agent does not come up:

- Check browser console for failed WebSocket RPC subscriptions.
- Check whether the UI waited on the correct session name.
- Check supervisor logs for the exact API route used.
- Check whether API city-scoped routes returned 404 and whether fallback TOML
  patching happened.
- Check stale session records for old workdirs or package paths.
- Check provider-specific errors in T3 work logs.
- Check whether generated runtime `.gc/site.toml` points rig paths at repos, not
  packages or city roots.

Write down the failing route, expected route, session name, and observed thread
state before editing code.

## Fix And Verify

When an issue is found:

1. Patch the smallest code path that caused the observed mismatch.
2. Add or update a targeted regression test with generic city, rig, and agent
   names.
3. Run the smallest relevant test.
4. Restart or refresh only the necessary runtime.
5. Repeat the one-agent sidebar verification end to end.

Do not declare a fix until the target agent has a visible thread in the expected
folder or the remaining blocker is captured with exact logs and a bead.

## Parallel Work Beads

Create beads for independent issues. Include this full skill text in each bead
body and tell the assignee:

- Follow this skill exactly.
- Work one agent at a time.
- Update this skill file if you discover a better diagnostic technique.
- Do not hide threads or add filtering as a workaround.
- Prefer upstream sidebar behavior for normal project/thread rows.
