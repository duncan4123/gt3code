# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

## Installation

> [!WARNING]
> T3 Code currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

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

## Bundled Gas City on `ship`

The `ship` branch includes a bundled Gas City runtime for local T3Code
development. T3Code ships the GC config, Gastown packs, and a platform-specific
`gc` binary under [`packages/gascity-config`](./packages/gascity-config). At
runtime these are materialized into a writable state directory:

```text
~/.local/state/t3code/gascity/current
```

The packaged city lives at:

```text
~/.local/state/t3code/gascity/current/city
```

Use the repo scripts instead of raw `gc` when you want the bundled T3Code city.
The global `gc` binary still uses normal GC discovery from the current working
directory, so running `gc status` from the repo root will look for
`./city.toml`.

```bash
# Install or refresh the bundled config and binary.
bun gascity:install

# Start the bundled city under the GC supervisor.
bun gascity:start

# Show bundled city status.
bun gascity:status

# Stop the bundled city sessions/supervisor.
bun gascity:stop

# Show resolved bundled GC config.
bun gascity:config

# Print runtime paths used by T3Code.
bun gascity:path

# Run any GC command against the bundled city.
bun gc -- status
bun gc -- session list
```

`bun dev` also exports the bundled GC environment for the T3 server:

```text
T3CODE_GASCITY_HOME=~/.local/state/t3code/gascity/current
GC_CITY_PATH=~/.local/state/t3code/gascity/current/city
GC_BIN=~/.local/state/t3code/gascity/current/bin/gc
GC_API_URL=http://127.0.0.1:8372
```

The T3 sidebar GC button starts the bundled supervisor through the server API.
Sidebar controls persist supported GC changes back to the packaged
`city.toml`, especially city-scoped agents such as `mayor`, `deacon`, `boot`,
and the `dog` pool. Rigs should be added from the sidebar add-project flow using
the "rig" target; new bundled installs start with no rigs.

Important storage distinction:

- T3Code app state uses Doltlite/SQLite under `~/.t3`.
- Gas City rig/bead state uses Dolt under the packaged city `.beads` directory.
- Do not delete `.beads/dolt` unless you intentionally want to reset GC bead
  state.

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
