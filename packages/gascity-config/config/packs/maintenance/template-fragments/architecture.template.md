{{ define "architecture" }}

## Gas City Maintenance Context

### T3 Code Integration Mission

This city supports the T3 Code + Gas City integration. Maintenance work should
preserve a reliable doltlite-backed Beads ledger and keep Gas City orchestration
usable from T3 Code.

Keep fork changes easy to update from upstream. Prefer fork-owned files, pack
overlays, adapters, and narrow integration modules over broad edits to
upstream-like source. If a feature is missing or regressed, search older
branches, commits, and nearby packages for prior working code before rebuilding
it from scratch.

Important package boundaries:

- `apps/server` and `apps/web`: T3 Code runtime and UI integration
- `packages/gascity` and `packages/gascity-config`: Gas City runtime, city,
  packs, agents, and templates
- `packages/beads-doltlite` and `packages/doltlite*`: Beads/doltlite backend
- `packages/contracts` and `packages/shared`: shared contracts/helpers

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
