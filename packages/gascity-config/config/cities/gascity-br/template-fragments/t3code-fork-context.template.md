{{ define "t3code-fork-context" }}

## T3 Code Fork Context

This repository is an **independent fork of upstream T3 Code** (`pingdotgg/t3code`) that integrates **GasCity orchestration** with a **DoltLite/BEADS backend**.

### What We Are Building

We are developing an integration between three systems:

1. **T3 Code** (`apps/`, `packages/contracts`, `packages/shared`) — The web GUI and WebSocket server from upstream
2. **GasCity** (`packages/gascity/`) — Composable orchestration infrastructure for multi-agent coding workflows
3. **BEADS + DoltLite** (`packages/beads-doltlite/`, `packages/doltlite/`) — Distributed graph issue tracker and database backend

### Upstream Alignment

- Our canonical product history is `main@origin`; upstream `pingdotgg/t3code` is an input source that we periodically integrate
- **Do NOT treat upstream `main` as our trunk**
- When bringing in upstream changes, start from our product branch, create a rescue bookmark, integrate upstream in a separate workspace/change, resolve conflicts there, and validate before moving our product bookmark forward
- **Prefer new files owned by our fork** over modifying upstream files
- **Use patterns that make upstream updates trivial:** hook into upstream via well-defined extension points, keep fork-specific logic in separate files, avoid inline modifications to upstream code

### Finding Lost Features

Our features have been lost repeatedly during upstream integration. Older branches and commits contain working implementations.

**Before reimplementing anything**, search for the feature:

```bash
jj log --grep "feature-name"
jj log --grep "sidebar" --limit 50
jj diff --from <change-id> --to <change-id>
```

Check rescue bookmarks:

```bash
jj bookmark list | grep rescue
```

Common rescue bookmarks: `rescue/feature-set-repair-20260518`, `rescue/pre-worker-sidebar`, `rescue/current-accidental-sidebar`

Search older upstream-sync branches:

```bash
jj bookmark list | grep t3code/
jj bookmark list | grep gc-
```

Look at snapshot branches:

```bash
jj bookmark list | grep snapshot
```

The working implementation is almost certainly in our history somewhere.

### Code Ownership

When adding features:

1. **Check if upstream T3 Code has a similar feature** — study how they implement it and hook into their patterns
2. **Put fork-specific code in our own packages** — prefer `packages/gascity-config/`, `packages/gascity/src/`, or new files in `apps/server/src/gc/` over modifying upstream server files
3. **Minimize edits to upstream files** — keep changes as small as possible and document why they're needed
4. **Use adapters and composition** — create adapter layers rather than inline modifications
5. **Test upstream compatibility** — verify core T3 Code functionality still works without GasCity/BEADS enabled

### Package Structure

**Upstream packages (synced from pingdotgg/t3code):**

- `apps/server` — WebSocket server, provider session management
- `apps/web` — React/Vite UI
- `apps/desktop` — Electron desktop app
- `packages/contracts` — Shared schemas and TypeScript contracts
- `packages/shared` — Shared runtime utilities

**Fork-owned packages (our integrations):**

- `packages/gascity/` — GasCity orchestration SDK
- `packages/beads-doltlite/` — BEADS issue tracker
- `packages/doltlite/` — DoltLite embedded database
- `packages/doltlite-client/` — DoltLite client bindings
- `packages/gascity-config/` — Bundled GasCity configuration
- `packages/effect-acp/` — ACP effect layer
- `packages/effect-codex-app-server/` — Codex app server effect bindings
- `packages/client-runtime/` — Client runtime utilities
- `packages/ssh/` — SSH utilities
- `packages/tailscale/` — Tailscale integration

### Integration Points

**GasCity ↔ T3 Code:**

- `apps/server/src/gc/` — GasCity API client and integration layers
- `apps/server/src/ws.ts` — WebSocket server with GasCity diagnostics
- `apps/web/src/routes/settings.gascity.tsx` — GasCity settings page
- `packages/gascity-config/` — Bundled city configuration shipped with T3 Code

**BEADS ↔ T3 Code:**

- Issue tracking via `bd` CLI
- Dolt database for persistent structured memory

**DoltLite ↔ BEADS:**

- `packages/doltlite/` provides the embedded Dolt database
- `packages/beads-doltlite/` uses DoltLite for issue storage

### Development Setup

```bash
bun install .
bun run build:gascity-tools
bun gascity:install
bun gascity:start
bun dev
```

Runtime paths:

- T3 Code data: `./.t3-dev`
- GasCity supervisor/runtime: `./.t3-dev/gascity`
- GasCity worktrees: `./.t3-dev/worktrees`
- Bundled city config: `./packages/gascity-config/config/cities/*`

All bundled GasCity paths are derived from the T3 Code install root.

### Fork Stack Ledger

See `docs/t3code-fork-stack-ledger.md` for the current fork-owned changes that should be replayed when rebasing onto upstream/main.

Key conflict surfaces:

- `apps/server/src/gc/**` — GasCity integration
- `apps/server/src/persistence/**` — Doltlite/checkpoints
- `apps/server/src/orchestration/**` — Provider orchestration
- `apps/web/src/components/Sidebar.tsx` — Left sidebar
- `apps/web/src/components/ChatView.tsx` — Right sidebar/chat
- `packages/gascity-config/config/**` — Bundled config
  {{ end }}
