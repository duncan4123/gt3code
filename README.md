# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex, Claude, and OpenCode, more coming soon).

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, and OpenCode.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Run without installing

```bash
npx t3
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## Fork maintenance

This repository is maintained as an independent fork of upstream T3 Code. Our
canonical product history is `main@origin`; upstream `pingdotgg/t3code` is an
input source that we periodically integrate.

Jujutsu repo configuration should follow this policy:

```bash
jj config set --repo git.fetch '["upstream", "origin"]'
jj config set --repo git.push origin
jj bookmark track main --remote=origin
jj bookmark untrack main --remote=upstream
jj config set --repo 'revset-aliases."trunk()"' main@origin
```

Do not treat upstream `main` as our trunk. When bringing in upstream changes,
start from our product branch, create a rescue bookmark, integrate upstream in a
separate workspace/change, resolve conflicts there, and validate before moving
our product bookmark forward. This keeps Gas City, bundled config, VCS/JJ, and
runtime integration work from being reduced to a partial replay stack.

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

### Bundled Gas City runtime

Local development uses checkout-local runtime state by default:

- T3 Code data: `./.t3-dev`
- Gas City supervisor/runtime: `./.t3-dev/gascity`
- Gas City worktrees: `./.t3-dev/worktrees`
- Bundled city config: `./packages/gascity-config/config/cities/*`

This is intentional. A clean install, a second checkout, or a JJ workspace must
not reuse a supervisor registry from another T3 Code installation. Reusing a
machine-global `GC_HOME` can make `gc start` fail with a city-name collision, or
make the app talk to a city registered from a different checkout.

All bundled Gas City paths should be derived from the T3 Code install root. The
app must not read `~/.gc`, `/home/.../go/bin/gc`, another checkout's `.t3-dev`,
or a machine-global supervisor registry. `bun gc ...` and the T3 server set
`GC_HOME`, `T3CODE_GASCITY_HOME`, `GC_BIN`, `BD_BIN`, and worktree paths to the
install-local runtime.

#### `.t3-dev/gascity` directory layout

```
.t3-dev/gascity/
├── bin/                # gc, bd, br binaries + libdoltlite.so
├── cities.toml         # supervisor city registry (one city: gastown-dolt)
├── supervisor.toml     # supervisor config (port, etc.)
├── supervisor.sock     # Unix socket for API
├── supervisor.log      # supervisor process logs (gc supervisor logs)
├── supervisor.lock     # process lock
├── events.jsonl        # supervisor-level events
└── runtime.env         # generated env vars (GC_HOME, GC_API_URL, etc.)
```

Key paths are resolved via `runtime.env`:

| Variable | Value |
|----------|-------|
| `GC_HOME` | `./.t3-dev/gascity` |
| `GC_API_URL` | `http://127.0.0.1:<port>` (port from `supervisor.toml`) |
| `GC_BIN` | `./.t3-dev/gascity/bin/gc` |
| `BD_BIN` | `./.t3-dev/gascity/bin/bd` |
| `GC_WORKTREES_DIR` | `./.t3-dev/worktrees` |

The supervisor API port is configured in `supervisor.toml` (`[supervisor] port`).
This is set by the T3 Code app, not hardcoded — it uses `GC_API_URL` from
`runtime.env`.

#### Gas City version and upstream sync

The bundled GC binary is built from source and synced from upstream
`gastownhall/gascity` main. The sync metadata lives at
`packages/gascity/source.sync.json`. Current target: **v1.2.0** (2026-05-25).

After an upstream sync, run `gc doctor` and `gc doctor --fix` to migrate
pack/city config to the current schema. Pack V2 enforcement (`schema = 2`,
`[imports.*]`, conventional directories) is now required.

#### Supervisor lifecycle

The supervisor is started and stopped by the T3 Code app via `gc supervisor run`
(not systemd when running from this checkout). The T3 Code server manages the
supervisor process lifecycle — do NOT start a standalone `gc supervisor run` or
`bd dolt start` against the same city. Gas City v1.2.0 rejects managed startup
if a standalone Dolt server holds `.beads/dolt`.

Design question: packaged desktop/user installs should likely use an
app-relative runtime directory rather than the development `./.t3-dev` path. The
invariant is the same either way: the runtime root belongs to that T3 Code
installation and is not shared with other T3 Code or standalone Gas City installs
on the machine.

For a clean dev setup:

```bash
bun install .
bun run build:gascity-tools
bun gascity:install
bun gascity:start
bun dev
```

Only override `T3CODE_HOME`, `T3CODE_GASCITY_HOME`, `T3CODE_WORKTREES_DIR`,
`GC_CITY_PATH`, or `GC_API_URL` when deliberately connecting this checkout to an
external runtime.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
