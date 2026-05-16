{{ define "cm-memory" }}

## CM Memory

Before starting non-trivial work, ask CM for relevant playbook guidance:

```bash
cm context "<current bead or task>" --json || true
```

Use `cm quickstart --json` if the workflow is unclear. CM is a secondary memory
system: it informs decisions but does not replace bead state, `br`, `gc mail`,
or explicit human instructions.
{{ end }}
