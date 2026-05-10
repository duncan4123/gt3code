# CM Pack

Persistent memory via [cass_memory_system](https://github.com/Dicklesworthstone/cass_memory_system).

## What this pack provides

- **MCP server**: `cass-memory` wired to `http://127.0.0.1:8766/mcp`
- **Skill**: `/recall` — query playbook for relevant rules before starting work
- **Skill**: `/reflect` — trigger reflection on recent sessions to extract lessons
- **Prompt fragment**: `cm-memory` — reminds agents to run `cm context`

## Prerequisites

Install and start the cass-memory server:

```bash
pip install cass-memory-system
cm init
packages/gascity-config/config/cities/gascity-br/packs/flywheel/cm/scripts/start-cm.sh
```

Optional: set up nightly reflection via cron:

```bash
crontab -e
# Add: 0 3 * * * cm reflect --recent 20
```

**Note:** `cm` depends on `cass` being installed (it reads session data).

## Usage

Add to your city's `pack.toml`:

```toml
[imports.cm]
source = "../packs/flywheel/cm"
```
