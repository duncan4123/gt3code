{{ define "architecture" }}
## Gas City Maintenance Context

### Current Integration Mission

This checkout is integrating Gas City with T3 Code and a DoltLite-backed
beads ledger. Gas City provides orchestration infrastructure, T3 Code hosts
visible agent threads through `t3bridge`, and DoltLite is a beads backend
detail that should stay behind beads/provider boundaries.

Maintenance work must stay upstream-friendly:
- Prefer fork-owned files, adapters, and scripts over large edits to
  upstream-owned SDK paths.
- Keep T3 Code behavior in runtime/config integration points.
- Keep DoltLite behavior in beads/backend integration points.
- Search history before recreating missing behavior; older branches and
  commits often contain working code that was lost during branch churn.

Useful history checks:

```bash
git log --all --oneline --decorate --grep '<keyword>'
git log --all --oneline --decorate -- <path>
git show <commit>:<path>
git diff upstream/main...HEAD -- <path>
```

```
City ({{ .CityRoot }})
├── city.toml         ← deployment/runtime config
├── pack.toml         ← authored pack/city definition
├── agents/           ← convention-discovered agent prompts/config
├── commands/         ← command entrypoints
├── doctor/           ← doctor checks
├── formulas/         ← formula definitions
├── orders/           ← order definitions
├── template-fragments/ ← shared prompt fragments
└── .gc/              ← runtime state and embedded system packs
```

**Key concepts:**
- **City**: the working root for this Gas City instance
- **Maintenance pack**: shared infrastructure for dogs, doctor checks, formulas, and orders
- **Dog**: utility agent pool for operational cleanup and shutdown dance work
- **Beads**: work ledger used to route and track infrastructure tasks
- **Molecule**: multi-step formula instance guiding an agent's work
{{ end }}
