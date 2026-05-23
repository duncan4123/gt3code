# AGENTS.md

## Task Completion Requirements

- Run the smallest verification that matches the change. Do not run full repo
  gates by default.
- For docs, ledgers, comments, prompt/config text, or other non-runtime edits,
  run only the relevant formatter or targeted check.
- For scoped code changes, prefer targeted package/file checks first. Run full
  `bun fmt`, `bun lint`, and `bun typecheck` only when the change touches shared
  contracts, build/workspace wiring, cross-package runtime behavior, or when the
  user explicitly asks for full gates.
- If a full gate is likely to take a long time, say so before starting it and
  explain why it is warranted.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Gas City / T3Code Integration Model

This repo is part of a three-fork integration effort:

- `/data/projects/t3code`: T3Code app and JJ workspace. This is where the app is
  run from and where package artifacts are consumed.
- `/data/projects/gascity`: our Gas City fork. It owns GC runtime, T3Bridge,
  agents, convoys, packs, and orchestration behavior.
- `/data/projects/beads-doltlite`: our Beads fork. It owns the DoltLite Beads
  backend, storage/schema behavior, and `bd` semantics used by Gas City.

`packages/gascity/source` and `packages/beads-doltlite/source` are copied source
artifacts, not authoritative history. Their source-of-truth metadata lives in:

- `packages/gascity/source.sync.json`
- `packages/beads-doltlite/source.sync.json`

When debugging missing behavior or regressions, compare all three boundaries:

1. upstream repo -> our fork branch
2. our fork branch -> packaged source copy
3. packaged source copy -> current T3Code JJ stack / `live/current`

Do not assume missing behavior is new work. We have repeatedly lost features
during upstream syncs and package-copy updates. Before reimplementing behavior,
search the relevant fork's branches, remotes, and checkpoint refs for older
working code, especially DoltLite, T3Bridge, convoy, pool-agent, session, and
package-sync changes.

Keep fork features easy to replay on new upstreams. Prefer small, well-named
commits and fork-owned files/adapters over broad edits to upstream-owned code.
When upstream structure changes, port the fork behavior into the new upstream
shape instead of preserving stale architecture.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Fork Context: T3 Code + GasCity + DoltLite/BEADS

This repository is an **independent fork of upstream T3 Code** (`pingdotgg/t3code`) that integrates **GasCity orchestration** with a **DoltLite/BEADS backend**.

### What We're Building

We are developing an integration between three systems:

1. **T3 Code** (`apps/`, `packages/contracts`, `packages/shared`) — The web GUI and WebSocket server from upstream
2. **GasCity** (`packages/gascity/`) — Composable orchestration infrastructure for multi-agent coding workflows
3. **BEADS + DoltLite** (`packages/beads-doltlite/`, `packages/doltlite/`) — Distributed graph issue tracker and database backend

### Upstream Alignment Policy

Our canonical product history is `main@origin`; upstream `pingdotgg/t3code` is an input source that we periodically integrate.

**Critical rules for upstream alignment:**

- **Do NOT treat upstream `main` as our trunk.** When bringing in upstream changes, start from our product branch, create a rescue bookmark, integrate upstream in a separate workspace/change, resolve conflicts there, and validate before moving our product bookmark forward.
- **Prefer new files owned by our fork** over modifying upstream files. Add new packages, new modules, new routes, new components — don't edit upstream files unless necessary.
- **Use patterns that make upstream updates trivial:**
  - Hook into upstream via well-defined extension points (settings pages, provider adapters, WebSocket channels)
  - Keep fork-specific logic in separate files that upstream changes are unlikely to touch
  - Avoid inline modifications to upstream code; use composition, adapters, or configuration instead
- **Our features have been lost repeatedly during upstream integration.** Older branches and commits contain working implementations of features we are trying to fix. Always search history before reimplementing.

### Finding Lost Features

When a feature is broken or missing after an upstream merge:

1. **Search jj history for the feature:**
   ```bash
   jj log --grep "feature-name"
   jj log --grep "sidebar" --limit 50
   jj diff --from <change-id> --to <change-id>
   ```

2. **Check rescue branches:** We maintain rescue bookmarks for feature sets:
   ```bash
   jj bookmark list | grep rescue
   ```
   Common rescue bookmarks: `rescue/feature-set-repair-20260518`, `rescue/pre-worker-sidebar`, `rescue/current-accidental-sidebar`

3. **Search for the feature in older upstream-sync branches:**
   ```bash
   jj bookmark list | grep t3code/
   jj bookmark list | grep gc-
   ```

4. **Look at the snapshot branches:**
   ```bash
   jj bookmark list | grep snapshot
   ```

5. **Before reimplementing anything**, check if the code exists in an older branch. The working implementation is almost certainly in our history somewhere.

### Package Structure

**Upstream packages (synced from pingdotgg/t3code):**
- `apps/server` — WebSocket server, provider session management
- `apps/web` — React/Vite UI
- `apps/desktop` — Electron desktop app
- `packages/contracts` — Shared schemas and TypeScript contracts
- `packages/shared` — Shared runtime utilities

**Fork-owned packages (our integrations):**
- `packages/gascity/` — GasCity orchestration SDK (Go binaries and source)
  - `packages/gascity/source/` — GasCity Go source code
  - `packages/gascity/bin/` — Built GC binaries
  - `packages/gascity/src/index.ts` — Node.js package entrypoint for binary discovery
- `packages/beads-doltlite/` — BEADS issue tracker (Go binaries and source)
  - `packages/beads-doltlite/source/` — BEADS Go source code
- `packages/doltlite/` — DoltLite embedded database (C/Go source)
  - `packages/doltlite/source/` — DoltLite source code
- `packages/doltlite-client/` — DoltLite client bindings
- `packages/gascity-config/` — Bundled GasCity configuration (city.toml, packs)
  - `packages/gascity-config/config/cities/` — City configurations
  - `packages/gascity-config/config/packs/` — Pack configurations
- `packages/effect-acp/` — ACP (Agent Communication Protocol) effect layer
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
- Integration markers in this file (`<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
