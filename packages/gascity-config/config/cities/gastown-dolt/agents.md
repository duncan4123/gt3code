# Agent Configuration — gastown-dolt

## How agents are defined

Agents come from two sources:

1. **Packs** (`pack.toml`, `packs/*/agents/*/agent.toml`) — define agent templates with prompts, nudge messages, work directories, default provider, and formulas. These are reusable across cities.

2. **City patches** (`city.toml` `[[patches.agent]]`) — override any field on an agent by matching `name` and optional `dir` (rig). Patches set the provider, wake mode, extra fragments, and suspension state for this city.

The effective agent config is: pack template → merged with city patch overrides → resolved with GC defaults.

## Adding a new agent

1. Create the agent template in a pack: `agent.toml` with `name`, `prompt_template`, `nudge`, `work_dir`, `provider`, etc.
2. Add a `[patches.agent]` entry in `city.toml` to activate and configure it for this city:

```toml
[[patches.agent]]
dir = "t3code"              # rig name, or "" for city-scoped
name = "gastown.myagent"    # full agent name
provider = "deepseek"       # must match a [providers.<name>] in pack.toml
wake_mode = "resume"        # resume | fresh
```

## Sidebar controls — what enables them

| Control                    | Config field                                                | Values                 |
| -------------------------- | ----------------------------------------------------------- | ---------------------- |
| **Suspend/Resume**         | `suspended` on agent override or patch                      | `true` / `false`       |
| **Session mode**           | `named_session_mode` (from `[[named_session]]`)             | `always` / `on_demand` |
| **Wake mode**              | `wake_mode` on agent patch                                  | `resume` / `fresh`     |
| **Pool scaling** (min/max) | `min_active_sessions` + `max_active_sessions` on agent.toml | integers               |
| **Wake session** button    | Session exists and is asleep                                | —                      |
| **Create new thread**      | Rig has a repository project folder                         | —                      |

## Pool agent controls (min/max active sessions)

Pool agents auto-scale based on demand. To enable pool scaling controls:

```toml
# In the agent's agent.toml (pack-level):
min_active_sessions = 1
max_active_sessions = 5
is_pool = true  # marks this as a pool agent
```

**Implicit pool workers** (auto-generated from `[providers.<name>]` entries) are
NOT real agents and do NOT get pool controls. They use `pool-worker.md` as a
generic dispatch template. They should be filtered from the sidebar by the
server's `normalizeGcConfig`.

Example of a correctly configured pool agent:

```toml
# packs/gastown-upstream/agents/polecat/agent.toml
name = "polecat"
provider = "kimi-for-coding"
min_active_sessions = 0
max_active_sessions = 5
is_pool = true
work_dir = ".gc/worktrees/{{.Rig}}/polecats/{{.AgentBase}}"
```

## Named sessions (always vs on_demand)

A `[[named_session]]` entry creates a persistent session for an agent:

```toml
[[named_session]]
template = "witness"       # agent template name
scope = "rig"              # city | rig
dir = "t3code"             # rig name (for scope=rig)
mode = "always"            # always | on_demand
```

- `always` — session starts automatically when the city starts
- `on_demand` — session starts when work is assigned or manually woken

## Provider configuration

Providers are defined in `pack.toml`:

```toml
[providers.deepseek]
base = "builtin:opencode"

[providers.deepseek.env]
GC_PROVIDER = "opencode"
GC_MODEL = "deepseek/deepseek-v4-pro"
GC_OPENCODE_AGENT = "build"
```

The `GC_MODEL` must match a valid model slug from `opencode models`.
Valid DeepSeek slugs: `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`.

## Rig paths

Each rig needs its own repository root path:

```toml
[[rigs]]
name = "t3code"
path = "/data/projects/t3code/.t3-dev/workspaces/t3code/live"
prefix = "t3"

[[rigs]]
name = "beadstui"
path = "/data/projects/t3code/.t3-dev/workspaces/t3code/live/packages/gascity-config/config/cities/gastown-dolt/rigs/beadstui"
prefix = "btui"
```

**Rules:**

- Each rig must point to a unique repository root (has `.jj/` or `.git/`)
- Two rigs sharing the same path prevent T3Code from creating separate project folders
- The sidebar creates one project folder per unique repository root

## Known issues

1. **Implicit pool workers appearing** — `codex`, `deepseek`, `kimi-for-coding` are auto-generated from provider config. Filtered server-side by `normalizeGcConfig` in `GcApiClient.ts`. Requires fresh T3 server start (cache clear).

2. **Wrong-city agents** — when multiple cities are loaded, `mergeMultiCityConfig` flatMaps all agents. GASTOWN's agents may appear under GASTOWN-DOLT in the sidebar if the grouping logic doesn't disambiguate by city ownership.

3. **Missing rig folder label** — rigs without threads don't get a folder header in the sidebar. Fixed in `packages/contracts/src/gc.ts` to create rig groups from config regardless of thread presence.

4. **Pool controls visibility** — only show when `is_pool: true` is explicitly set on the agent config. `polecat` and `dog` should have this.

5. **City restart required** — after changing `city.toml` or `pack.toml`, run `gc restart` to apply. The T3 server also needs restart if `GcApiClient.ts` changes.
