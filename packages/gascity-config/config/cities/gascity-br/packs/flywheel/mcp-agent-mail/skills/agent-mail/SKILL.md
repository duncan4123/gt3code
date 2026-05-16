---
name: agent-mail
description: Use MCP Agent Mail as a secondary coordination channel for messages, acknowledgements, and file reservations.
---

# Agent Mail

Use Agent Mail as a secondary MCP channel. Gas City `gc mail` remains canonical
for durable handoffs, escalations, and messages that must survive session
restart.

Useful MCP tools:

- `macro_start_session`
- `fetch_inbox`
- `send_message`
- `acknowledge_message`
- `file_reservation_paths`
- `release_file_reservations`
- `summarize_thread`

For code work, use the absolute repo root as `project_key`. For beads-rust
polecats in this city, that is the configured `beads_rust` rig root. Use the
bead id as `thread_id` when the message is tied to a bead.
