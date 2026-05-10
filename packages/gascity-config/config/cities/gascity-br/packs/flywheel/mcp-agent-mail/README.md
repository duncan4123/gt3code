# MCP Agent Mail Pack

Inter-agent messaging via [mcp-agent-mail](https://github.com/Dicklesworthstone/mcp_agent_mail).

## What this pack provides

- **MCP catalog**: `agent-mail` wired to `http://127.0.0.1:8765/mcp/`
- **Skill**: `/coordinate` — register identity, send/receive messages, reserve files
- **Hook**: `UserPromptSubmit` — checks inbox on each prompt
- **Prompt fragment**: `agent-mail-secondary` — explains Agent Mail as a
  secondary channel next to canonical `gc mail`

## Prerequisites

Gas City packs can project MCP config, but pack-owned services are not yet
supervised by the GC loader. Start the local server with the pack helper:

```bash
packages/gascity-config/config/cities/gascity-br/packs/flywheel/mcp-agent-mail/scripts/start-agent-mail.sh
```

The helper uses `/home/ubuntu/mcp_agent_mail` by default and leaves logs under
`/tmp/gascity-mcp-agent-mail/server.log`. Override the checkout or port if
needed:

```bash
MCP_AGENT_MAIL_REPO=/path/to/mcp_agent_mail MCP_AGENT_MAIL_PORT=8765 \
  packages/gascity-config/config/cities/gascity-br/packs/flywheel/mcp-agent-mail/scripts/start-agent-mail.sh
```

Localhost unauthenticated mode is enabled by default by the server. If you
disable it, set `MCP_AGENT_MAIL_TOKEN` in the agent environment and add the
matching authorization header in the MCP definition.

## Usage

Add to your city's `pack.toml`:

```toml
[imports.mcp-agent-mail]
source = "../packs/flywheel/mcp-agent-mail"
```
