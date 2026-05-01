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
development. T3Code ships the GC config and Gastown packs under
[`packages/gascity-config`](./packages/gascity-config). The `gc` and `bd`
binaries are built from workspace packages and copied into a writable runtime
state directory:

```text
Linux:   ~/.local/state/t3code/gascity/current
macOS:   ~/Library/Application Support/T3Code/GasCity/current
Windows: %LOCALAPPDATA%\T3Code\GasCity\current
```

Source/build package layout:

```text
packages/gascity           builds gc from Gas City Go source
packages/beads-doltlite    builds bd from beads-doltlite Go source
packages/gascity-config    owns city.toml, pack.toml, packs
```

Build the tool binaries before installing or running the packaged city:

```bash
bun build:gascity-tools
bun gascity:install
```

`bun build:gascity-tools` writes ignored binaries under:

```text
packages/gascity/bin/<platform>-<arch>/gc
packages/beads-doltlite/bin/<platform>-<arch>/bd
```

These built binaries are not committed. `bun gascity:install` copies them into:

```text
<runtime>/bin/gc
<runtime>/bin/bd
```

T3Code and the packaged Gas City use one shared worktree root:

```text
T3CODE_WORKTREES_DIR=$T3CODE_HOME/worktrees
```

T3-created thread worktrees live directly under that root by repository and
branch. Gastown-created worktrees live under the `gascity/` namespace:

```text
~/.t3/worktrees/t3code/<branch>
~/.t3/worktrees/gascity/<rig>/refinery
~/.t3/worktrees/gascity/<rig>/crew/<agent>
~/.t3/worktrees/gascity/<rig>/polecats/<agent>
```

Use the repo scripts instead of raw `gc` when you want the T3Code packaged city.
The global `gc` binary still uses normal GC discovery from the current working
directory, so running `gc status` from the repo root will look for
`./city.toml`.

```bash
# Install or refresh built runtime binaries and machine-local config.
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
T3CODE_GASCITY_HOME=<runtime>
GC_CITY_PATH=packages/gascity-config/config
GC_BIN=<runtime>/bin/gc or <runtime>\bin\gc.exe
BD_BIN=<runtime>/bin/bd or <runtime>\bin\bd.exe
T3CODE_WORKTREES_DIR=$T3CODE_HOME/worktrees
GC_API_URL=http://127.0.0.1:8372
```

The T3 sidebar GC button starts the bundled supervisor through the server API.
Sidebar controls persist supported GC changes back to the packaged
`city.toml`, especially city-scoped agents such as `mayor`, `deacon`, `boot`,
and the `dog` pool. The packaged city now includes the T3Code `gascity` and
`beads-doltlite` rigs; machine-local rig path bindings still live in
`packages/gascity-config/config/.gc/site.toml`.

One config tree matters when changing bundled Gas City behavior:
`packages/gascity-config/config/...`. In development this is the active city
passed to `gc --city`, so edits apply to the running T3Code city after the
supervisor reloads or restarts. Runtime-local files under `.gc`, `.beads`, logs,
traces, and profiles are ignored.

For agent model selection, update the agent file:

```text
packages/gascity-config/config/packs/.../agents/<name>/agent.toml
```

Models are defined with GC-native agent-level `option_defaults.model`, not as
runtime-only environment truth:

```toml
provider = "codex"
option_defaults = { model = "gpt-5.4-mini" }
```

The bundled `boot` and `dog` agents use `gpt-5.4-mini`; `mayor`, `deacon`, and
the rig-scoped Gastown agents use `gpt-5.4`.
`[agent_defaults].model` may still appear in resolved config for display and
composition, but Gas City docs note that it is not auto-applied at runtime.
Avoid treating `GC_MODEL` as the source of truth for model selection.

Important storage distinction:

- T3Code app state uses Doltlite/SQLite under `~/.t3`.
- Gas City city/rig bead state uses `bd` with the doltlite backend under the
  packaged city `.beads` directories.
- Do not delete `.beads/doltlite` unless you intentionally want to reset GC
  bead state.

Runtime/doltlite debugging note: [docs/gascity-doltlite-runtime-notes.md](./docs/gascity-doltlite-runtime-notes.md)
maps the source trees, materialized runtime tree, `gc`/`bd` binary linkage,
`GASCITY_BINARY` install flow, and the `gc status` vs `gc session list`
mismatch checks.

Desktop release builds require built GC and beads binaries for the target
platform:

```text
packages/gascity/bin/linux-x64/gc
packages/beads-doltlite/bin/linux-x64/bd
packages/gascity/bin/win32-x64/gc.exe
packages/beads-doltlite/bin/win32-x64/bd.exe
```

Desktop builds fail fast if the matching `gc` or `bd` binary is missing.

### Context-Mode Comparison Note

The active context-mode database for the sidebar/Gas City comparison is named
`ship compare`. It has branch-specific indexed context:

- `git-ship`: maps to git branch `ship`. The bundled seed config lives at
  `/data/projects/t3code/packages/gascity-config/config`, which is also the
  default live T3 Gas City city in development.
- `git-codex-sidebar-pool-followup`: maps to git branch
  `codex/sidebar-pool-followup` and the old external config at
  `/data/projects/gc`.

Use that database when comparing sidebar controls against the exact TOML/pack
set each branch was using. For local historical comparison, also note
`/home/ubuntu/.local/state/t3code/gascity/dev/city`, which mirrors the older
multi-rig `/data/projects/gc` style more closely than the current packaged
runtime.

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
