---
name: cm
description: Query and update the CASS Memory playbook for task-specific operating guidance.
---

# CM Memory

Use `cm` before meaningful work to retrieve relevant playbook rules:

```bash
cm context "<task or bead id>" --json
cm quickstart --json
cm similar "<topic>" --json
```

Use `cm reflect --recent 20 --json` only when asked to extract new rules from
recent sessions. Prefer non-interactive `--json` output in agent sessions.
