{{ define "agent-mail-secondary" }}

## Agent Mail Secondary Channel

`gc mail` is the canonical Gas City mail system. Use it for escalations,
handoffs, mayor/witness/refinery messages, and anything that must survive a
session restart in the Gas City bead flow.

When the `agent-mail` MCP server is available, also use Agent Mail as a
secondary coordination channel:

- Register with `macro_start_session` using the absolute rig root as
  `human_key` / `project_key`.
- Use `fetch_inbox` and `acknowledge_message` for lightweight coordination.
- Use `send_message` with `thread_id=<bead-id>` to mirror coordination tied to
  a bead.
- Use `file_reservation_paths` before broad or conflict-prone edits, and
  release reservations when the edit block is complete.

Agent Mail does not wake sleeping sessions. Use `gc session nudge` for wakeups.
If Agent Mail is unavailable, keep working with `gc mail`, `gc session nudge`,
and bead state.
{{ end }}
