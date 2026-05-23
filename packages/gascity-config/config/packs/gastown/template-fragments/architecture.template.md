{{ define "architecture" }}

## Gas Town Architecture

### T3 Code Integration Mission

This town is part of the T3 Code + Gas City integration. We are wiring Gas City
agent orchestration into T3 Code while using a doltlite-backed Beads ledger for
issues, mail, metadata, hooks, and work history.

Keep work aligned with upstream. Prefer fork-owned files, pack overlays,
adapters, and narrow integration modules over broad edits to upstream-like
source. If a feature is missing or regressed, assume older branches or commits
may already contain working code; search history and nearby packages before
rebuilding it from scratch.

Package map:

- `apps/server`: T3 Code server bridge to provider sessions and Gas City runtime
- `apps/web`: T3 Code UI for sessions, events, sidebars, and GC panels
- `packages/gascity`: Gas City runtime/source packaging
- `packages/gascity-config`: fork-owned city, packs, agents, and templates
- `packages/beads-doltlite`, `packages/doltlite*`: local Beads backend
- `packages/contracts`, `packages/shared`: cross-package contracts and helpers

```
Town ({{ .CityRoot }})
├── controller        ← Go process: lifecycle management
├── deacon/           ← Town-wide coordination + judgment tasks
├── mayor/            ← Global coordinator
├── <rig>/            ← Per-rig infrastructure
│   ├── .beads/       ← Issue tracking (shared ledger)
│   ├── crew/         ← Named workspaces (persistent)
│   ├── polecats/     ← Worker worktrees (transient)
│   ├── refinery/     ← Merge queue processor
│   └── witness/      ← Work-health monitor
```

**Key concepts:**

- **Town**: Workspace root containing all rigs
- **Rig**: Container for a project (polecats, refinery, witness)
- **Polecat**: Transient worker agent with its own git worktree
- **Crew**: Persistent workspace managed by the overseer (human)
- **Witness**: Per-rig work-health monitor (orphaned beads, stuck polecats)
- **Refinery**: Per-rig merge queue processor
- **Deacon**: Town-wide patrol (gates, convoys, stuck agents)
- **Dog**: Utility agent pool (shutdown dance, warrants)
- **Beads**: Issue tracking system shared by all rig agents
- **Molecule**: Multi-step formula instance guiding an agent's work
  {{ end }}
