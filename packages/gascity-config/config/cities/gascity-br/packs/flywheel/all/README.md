# Flywheel All Pack

Roll-up pack that includes the full [Agent Flywheel](https://agent-flywheel.com/) enhancement stack:

- **mcp-agent-mail** — inter-agent messaging
- **cass** — session search
- **cm** — persistent memory / playbook
- **ubs** — pre-commit bug scanning
- **agent-browser** — browser UI automation and audit checks
- **jj** — Jujutsu/Jorje stack workflow guidance

## Prerequisites

See each individual pack's README for installation instructions.

## Usage

Full stack:

```toml
# pack.toml
[imports.flywheel]
source = "../packs/flywheel/all"
```

Or cherry-pick individual packs:

```toml
# pack.toml
[imports.mcp-agent-mail]
source = "../packs/flywheel/mcp-agent-mail"

[imports.ubs]
source = "../packs/flywheel/ubs"

[imports.agent-browser]
source = "../packs/flywheel/agent-browser"

[imports.jj]
source = "../packs/flywheel/jj"
```
