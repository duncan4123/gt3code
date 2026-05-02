# T3 Sidebar Agent Notes

## Gas City Named And Pool Session TOML

These notes document the Gas City TOML fields that drive the sidebar's named-session and pool-session controls. Source of truth is the Gas City repo, especially:

- `/data/projects/gascity/internal/config/config.go`
- `/data/projects/gascity/internal/config/patch.go`

### Named Sessions

Gas City named sessions are declared with `[[named_session]]`. They are not pool configs.

Fields:

- `name`: optional public named-session identity. If omitted, Gas City uses `template`.
- `template`: required backing agent template. May be a pack-qualified value such as `binding.agent`.
- `scope`: optional `city` or `rig`; controls pack expansion scope.
- `dir`: optional identity prefix for rig-scoped named sessions.
- `mode`: optional `on_demand` or `always`; default is `on_demand`.

Patch form is `[[patches.named_session]]` and supports only:

- `dir`: target key.
- `template`: required target key.
- `mode`: optional replacement mode, `on_demand` or `always`.

Do not model these as named-session TOML fields: `pin`, `wake_mode`, `min_active_sessions`, `max_active_sessions`. Pin is runtime bead metadata, not TOML. Wake and scaling live on the backing `[[agent]]`.

### Pool / Multi-Session Agents

Gas City pool sessions are ordinary `[[agent]]` templates with multi-session scaling. The sidebar should treat pool controls as agent-template controls, not named-session controls.

Core pool fields:

- `max_active_sessions`: agent cap. Nil inherits rig/workspace/unlimited; `-1` means unlimited; `0` disables generic routed work; `1` is single-session; values above `1` are pool-shaped.
- `min_active_sessions`: minimum sessions to keep alive. Effective default is `0`.
- `scale_check`: command whose output is the desired active session count.
- `drain_timeout`: scale-down grace duration. Default is `5m`.
- `on_boot`: command run once at controller startup.
- `on_death`: command run when a session dies unexpectedly.
- `namepool`: plain text file of display aliases for pool instances.
- `work_query`: command template for finding work.
- `sling_query`: command template for routing work to this agent.

Session lifecycle fields that also matter for sidebar behavior:

- `wake_mode`: `resume` or `fresh`; default is `resume`.
- `resume_command`: provider-specific resume command template.
- `idle_timeout`: kill/restart after inactivity.
- `sleep_after_idle`: sleep after idle duration, or `off`.
- `attach`: whether interactive attachment is supported.
- `depends_on`: agent wake dependencies.

Runtime/session startup fields valid on `[[agent]]` include:

- `session`, `provider`, `start_command`, `args`
- `prompt_mode`, `prompt_flag`
- `ready_delay_ms`, `ready_prompt_prefix`, `process_names`
- `nudge`, `work_dir`, `pre_start`
- `session_setup`, `session_setup_script`, `session_live`
- `overlay_dir`, `env`, `option_defaults`

### Legacy Pool Patch Form

Legacy `pool` subtables in `[[patches.agent]]` or rig overrides map to current agent fields:

- `pool.min` -> `min_active_sessions`
- `pool.max` -> `max_active_sessions`
- `pool.check` -> `scale_check`
- `pool.drain_timeout` -> `drain_timeout`
- `pool.on_death` -> `on_death`
- `pool.on_boot` -> `on_boot`

### Sidebar Rules

- Show min/max pool controls only when the agent group is explicitly identified as a pool.
- A named session can expose `max_active_sessions = 1` metadata through its backing agent; that must not make it look like a pool.
- Named-session mode controls map to `[[named_session]].mode`, not agent scaling.
- Wake/fresh/resume controls map to the backing agent's `wake_mode`, not `[[named_session]]`.
