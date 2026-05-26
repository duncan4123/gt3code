# T3 Code ←→ Gas City Health Check

Run these checks in order when verifying the integration is healthy after config
changes, restarts, or provider switches.

> **CRITICAL**: The T3 server uses doltlite as its state backend. Never read the
> state DB (`.t3-dev/dev/state-proj.sqlite`) with raw `sqlite3` — concurrent
> access causes "database disk image is malformed" errors. Use T3's API endpoints
> or the doltlite-backed client for all state reads.

## Model Configuration

### How GC agents get their model

GC agents inherit `GC_MODEL` from the provider definition in `pack.toml`:

```toml
[providers.deepseek]
base = "builtin:opencode"

[providers.deepseek.env]
GC_PROVIDER = "opencode"
GC_MODEL = "deepseek/deepseek-v4-pro"   # ← model slug
GC_OPENCODE_AGENT = "build"
```

The `GC_MODEL` env var is injected into the opencode binary when T3Bridge starts
a session. It must match a model available through the opencode binary.

### Listing available models

```bash
# Full list of models the opencode binary can use
opencode models
```

### Model slug prefixes

OpenCode exposes models from multiple provider backends. Each slug has a
`{provider_id}/{model_id}` format:

| Prefix | Source | Example |
|---|---|---|
| `opencode/` | OpenCode's built-in proxy (free) | `opencode/deepseek-v4-flash-free` |
| `deepseek/` | Direct DeepSeek API | `deepseek/deepseek-v4-pro` |
| `openrouter/` | OpenRouter API | `openrouter/deepseek/deepseek-v4-pro` |
| `google/` | Google AI / Vertex | `google/gemini-2.5-pro` |
| `kimi-for-coding/` | Kimi Coding API | `kimi-for-coding/k2p6` |

**The prefix matters.** `opencode/deepseek-v4-pro` does NOT exist — only
`opencode/deepseek-v4-flash-free`. Paid DeepSeek models use the `deepseek/`
or `openrouter/` prefix.

### T3 Code's default model

T3 Code's `DEFAULT_MODEL_BY_PROVIDER` for OpenCode is `"openai/gpt-5"`
(`packages/contracts/src/model.ts`). This is the model used for new threads
created directly in T3 Code that use the OpenCode provider instance.
GC agents bypass this — they use the `GC_MODEL` env var set by the GC provider
config.

### Changing models for existing sessions

After changing `GC_MODEL` in `pack.toml`:
1. Restart the city: `gc restart`
2. Existing session beads retain old model — only new sessions get the new model
3. To force old sessions: `gc session reset <id>` or close and let controller recreate

## Quick Sanity (1 min)

```bash
# 1. T3 server must be listening
lsof -i :3773 | grep -q LISTEN && echo "T3 OK" || echo "T3 DOWN"

# 2. GC supervisor must be running
gc cities | grep -q gastown-dolt && echo "GC OK" || echo "GC DOWN"

# 3. API health must report running phase
curl -s http://127.0.0.1:33269/health | jq -r '.startup.phase' | grep -q running && echo "API OK" || echo "API DOWN"

# 4. T3 web must be serving
curl -s -o /dev/null -w '%{http_code}' http://localhost:5733/ | grep -q 200 && echo "Web OK" || echo "Web DOWN"

# 5. OpenCode server must be reachable (T3 Code probes it for model discovery)
lsof -i :4096 | grep -q LISTEN && echo "OpenCode OK" || echo "OpenCode DOWN"

# 6. Only 1 Dolt server should be running (GC-managed)
DOLT_COUNT=$(ps aux | grep "dolt sql-server" | grep -v grep | wc -l)
[ "$DOLT_COUNT" -eq 1 ] && echo "Dolt OK ($DOLT_COUNT server)" || echo "Dolt WARN ($DOLT_COUNT servers)"

# 7. WebSocket URL must be configured for Vite dev server
grep -q "ws://localhost:3773" /proc/$(lsof -ti :5733 | head -1)/environ 2>/dev/null | tr '\0' '\n' | grep -q VITE_WS_URL && echo "WS URL OK" || echo "WS URL WARN"
```

## Full Checkup

### 1. T3 Server

```bash
# Confirm listening on correct port
lsof -i :3773

# Check server log for errors (last 20 lines)
tail -20 /tmp/t3server.log | grep -i error

# Verify dev auth is disabled (dev mode only)
curl -s -X POST http://localhost:3773/api/auth/dev/session
# Should return 404 (auth disabled) — not a crash

# Check state DB integrity — use T3's doltlite-backed client, never raw sqlite3
# The T3 server serializes writes through doltlite; concurrent raw sqlite3 reads
# cause "database disk image is malformed" errors.
# Check indirectly via API instead:
curl -s http://localhost:3773/api/state 2>&1 | head -5

# OpenCode server must be running for model discovery and provider probing
lsof -i :4096 | grep -q LISTEN || { echo "Start with: opencode serve --port 4096 &"; }
```

### 1b. Dolt Server Management

**Rule: one Dolt server per city using `backend = "dolt"`.** Multiple servers indicate
stale city registrations or bd CLI auto-starting its own shared server.

```bash
# List all Dolt servers — should show exactly one GC-managed server
ps aux | grep "dolt sql-server" | grep -v grep

# Kill stale servers (keep the GC-managed one)
# The GC-managed server's --config path should match the city's .gc/runtime/packs/dolt/
kill <PID>  # for each stale server

# Point bd CLI at the GC-managed Dolt (port varies, check .gc/runtime/packs/dolt/dolt-config.yaml)
echo "<port>" > .beads/dolt-server.port
# Or: export BEADS_DOLT_SERVER_PORT=<port>
```

**City backends:**
- `gastown-dolt`: `dolt` (GC-managed Dolt server)
- `gastown`: `doltlite` (local SQLite file `.beads/doltlite/t3.db`)
- `gascity-br`: `beads-rust-backend` (custom `br` binary)

**If you see `doltlite: file is not a database`:** A stale `.beads/doltlite/` directory
exists from a previous backend config. If the city uses Dolt, remove it:
`rm -rf .beads/doltlite`.```

### 2. GC Supervisor & City

### 1c. T3 Dev Environment (jj workspace + Vite)

The T3 dev server must run from a clean `live/current` child. Vite must have
`VITE_WS_URL` set or the web app can't reach the T3 WebSocket server.

```bash
# 1. Always start from a clean live/current child
jj new -r live/current -m "workspace"
bun run dev:server &

# 2. Wait for T3 to start, then switch working copy to your changes
sleep 20
jj edit <your-commit-change-id>

# 3. [CRITICAL] Start Vite with WS URL pointing to T3 server
#    The dev-runner sets this automatically in dev mode,
#    but NOT when running dev:web separately.
VITE_WS_URL=ws://localhost:3773/ws bun run dev:web &
# Or: cd apps/web && VITE_WS_URL=ws://localhost:3773/ws bun run dev &
```

**When `--watch` restarts don't pick up jj edit changes:**
Manually restart the dev server:
```bash
kill $(lsof -ti :3773)
jj new -r live/current -m "workspace"
bun run dev:server &
sleep 20
jj edit <your-commit>
```

```bash
# List registered cities — should include gastown-dolt
gc cities

# City status — controller should be supervisor-managed, not stopped
gc status

# Doctor check — all items must pass or warn, never fail
gc doctor

# Resolved config — verify provider chain
gc config show 2>&1 | grep -A2 "Provider inheritance"

# Session list — active sessions should exist
gc session list 2>&1 | head -20
```

**Red flags in gc status:**
- `Controller: stopped` — city not started
- `Suspended: yes` — city suspended in config
- All agents `stopped` AND controller not `checking agent images` — stuck
- `failed-create` on named sessions — session bead stuck (Dolt error)

### 3. Provider Verification

```bash
# Provider chain must resolve to correct backend
gc config show 2>&1 | grep "deepseek\|kimi\|codex"

# Verify opencode binary is running for active sessions
ps aux | grep opencode | grep -v grep

# Check opencode model env on running process
ps aux | grep opencode | awk '{print $2}' | head -1 | \
  xargs -I{} cat /proc/{}/environ 2>/dev/null | tr '\0' '\n' | grep GC_MODEL
```

Expected for deepseek provider: `GC_MODEL=opencode/deepseek-v4-pro`

### 4. T3 Bridge Connectivity

```bash
# T3 WebSocket must accept connections from GC
# Check supervisor logs for T3Bridge errors
gc supervisor logs 2>&1 | grep -i "t3bridge\|i/o timeout\|connection refused"

# All T3 WebSocket candidates failed → T3 server unreachable
# i/o timeout → T3 server not responding to WS handshake
# connection refused → T3 server not running on port
```

### 5. Sidebar Audit (Browser)

```bash
# Open T3 web UI
agent-browser --session health-check open http://localhost:5733/

# Wait for load
agent-browser --session health-check wait --load networkidle
sleep 3

# Snapshot sidebar — verify:
# - gastown-dolt city section visible
# - Agent pool workers match provider config
# - Active threads have recent timestamps
# - No kimi-for-coding pool workers under gastown-dolt
agent-browser --session health-check snapshot -c -d 10

# Check console for errors
agent-browser --session health-check errors
```

### 6. Event Stream

```bash
# Tail recent events — look for controller.started, bead.updated, session lifecycle
gc events 2>&1 | tail -30

# Key event types to watch:
# - controller.started — city startup complete
# - bead.updated with state=asleep/awake — session state changes
# - session lifecycle op=start — session creation
# - provider_error in outcome — T3Bridge or provider failure
```

## Common Failures & Fixes

| Symptom | Likely Cause | Fix |
|---|---|---|
| `T3 WebSocket candidates failed: connection refused` | T3 server not running | Start T3 dev server |
| `T3 WebSocket candidates failed: i/o timeout` | T3 server hung | Restart T3 server |
| `failed-create` session bead stuck | Dolt syntax error in bead close | Restart GC city |
| `adopting sessions` stuck >5 min | Slow `bd list` query blocking reconcile | Wait or restart |
| `No projects yet` in sidebar | No project added to T3 | Add project via UI |
| Agents `stopped` indefinitely | Controller still starting | Wait for `checking agent images` → `adopting sessions` |
| Wrong provider in sidebar | Config not reloaded | `gc restart` after config changes |
| OpenCode "Unavailable" in T3 settings | No opencode server on port 4096 | `opencode serve --port 4096 &` |
| GC agents using wrong model prefix | `opencode/deepseek-v4-pro` doesn't exist | Use `deepseek/deepseek-v4-pro` (check with `opencode models \| grep deepseek`) |
| `gc doctor` missing T3Code integration check | gc binary not rebuilt | New check in `checks_t3code.go`, needs `go build` on next deploy |
| Sidebar shows "No projects yet" but GC is running | `VITE_WS_URL` not set (Vite can't reach T3 WebSocket) | Start Vite with `VITE_WS_URL=ws://localhost:3773/ws bun run dev` |
| Multiple Dolt servers on different ports | Stale city registrations + bd shared server auto-start | Kill stale: `ps aux \| grep dolt \| grep -v grep` and remove wrong-path registrations |
| `bd` commands fail with "Dolt server unreachable" | bd uses shared server (port 35819) instead of GC-managed | Set `BEADS_DOLT_SERVER_PORT=30846` or kill shared server and point `dolt-server.port` at GC Dolt |
| `doltlite: file is not a database` | Stale `.beads/doltlite/t3.db` from previous backend switch | Remove stale doltlite dir if city uses Dolt: `rm -rf .beads/doltlite` |
| T3 server refuses to start (non-live workspace) | Working copy has uncommitted changes | `jj new -r live/current -m "workspace"` then `bun run dev:server` |
| Dev server picks up stale code after jj edit | `--watch` didn't trigger on jj working-copy switch | Restart dev server: `kill` + restart from clean workspace |

## After Provider Switch

After changing provider in city.toml/pack.toml:

```bash
# 1. Restart city to pick up new config
gc restart

# 2. Wait for controller to complete startup phases
#    (check gc status — controller should move past "checking agent images")

# 3. Verify provider chain
gc config show 2>&1 | grep -A2 "Provider inheritance"

# 4. Confirm new pool workers appear in sidebar
agent-browser --session health-check open http://localhost:5733/
agent-browser --session health-check wait --load networkidle
sleep 3
agent-browser --session health-check snapshot -c -d 10

# 5. Check opencode model env on running sessions
ps aux | grep opencode | awk '{print $2}' | \
  xargs -I{} cat /proc/{}/environ 2>/dev/null | tr '\0' '\n' | grep GC_MODEL
```

## Known Bugs & Partial Failures

### 1. FTS insert failure (`insertProjectionThreadMessageFtsRow`)

**Symptom:** Session lifecycle shows `provider_error` with `SQL error in ProjectionThreadMessageRepository.insertProjectionThreadMessageFtsRow`.

**Cause:** The T3 server's state DB is split into two files:
- `.t3-dev/dev/state.sqlite` — main DB, holds migration tracking
- `.t3-dev/dev/state-proj.sqlite` — sidecar ("proj" schema), holds hot tables including `messages_fts`

If the sidecar DB is deleted but the main DB is NOT, the migration tracker
says migration 038 is done. `ensureHotSidecarSchema` recreates the hot tables
in the fresh sidecar BUT does NOT create `proj.messages_fts` — that's only
created by migration 038 (which is skipped). The repo layer does bare
`INSERT INTO messages_fts` (no `proj.` prefix), hitting the missing table.

**Fix:** Delete BOTH state files:
```bash
rm -f .t3-dev/dev/state.sqlite .t3-dev/dev/state.sqlite-wal .t3-dev/dev/state.sqlite-shm
rm -f .t3-dev/dev/state-proj.sqlite .t3-dev/dev/state-proj.sqlite-wal .t3-dev/dev/state-proj.sqlite-shm
```
Then restart T3 server. All migrations will re-run and `proj.messages_fts` will be created.

**Better fix (code):** Add `messages_fts` creation to `ensureHotSidecarSchema` in `038_MoveHotTablesToBtreeSidecar.ts` so it handles missing-sidecar recovery.

### 2. Deacon bead stuck (`recompute is_blocked` Dolt syntax error)

**Symptom:** GC supervisor logs show repeatedly:
```
session beads: closing failed-create bead t3-u8m: recompute is_blocked (mark):
Error 1105: syntax error at position 2141 near '%!"(MISSING)gate":"any-children"%!'
```

**Cause:** `blocked_state.go:29` in the bd source defines a SQL constant with
LIKE patterns containing literal `%` signs:
```sql
d.metadata LIKE '%"gate":"any-children"%'
```
This constant is injected into a Go `fmt.Sprintf` template via `%s`, then the
resulting string is used as the format string for a SECOND `fmt.Sprintf` call.
The `%` signs from the LIKE pattern are interpreted as invalid Go format verbs.

**Fix:** Replace the `LIKE` pattern with JSON functions (upstream fix in
gastownhall/beads `main`):
```sql
d.metadata LIKE '%"gate":"any-children"%'  -- broken (fmt.Sprintf eats %)
-- Replace with:
JSON_UNQUOTE(JSON_EXTRACT(d.metadata, '$.gate')) = 'any-children'  -- correct
```
Then rebuild bd: `cd packages/beads-doltlite/source && CGO_ENABLED=1 go build -o .../bd ./cmd/bd`

### 3. bd list query blocks cache reconciler (large DB)

**Symptom:** `adopting_sessions` phase takes 5+ minutes. `beads cache` logs show
P95 latency 15-20s, cadence promoted to medium (60s).

**Cause:** `search_counts.go:120-179` — 6 uncorrelated LEFT JOIN subqueries with
full-table GROUP BY over labels, dependencies, wisp_dependencies, comments;
repeated twice (issues + wisps).

**Bead:** `gd-bdop` in hq database. Requires Go code changes.```
