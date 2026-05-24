{{ define "architecture" }}
## Gas Town Architecture

### Current Integration Mission

This city is part of the Gas City + T3 Code integration work. Gas City owns
the orchestration SDK; T3 Code hosts visible agent threads through the
`t3bridge` runtime provider; beads/bd with DoltLite backs the work ledger.

Keep fork work easy to update from upstream:
- Prefer fork-owned files, adapters, and provider boundaries over broad edits
  to upstream-owned SDK code.
- Keep T3 Code assumptions inside the `t3bridge` runtime/config path.
- Keep DoltLite assumptions inside beads/backend boundaries.
- Before rebuilding a missing feature, search old branches and commits. This
  repo has lost working integration code during branch churn, so history often
  contains the prior fix.

Good archaeology commands:

```bash
git log --all --oneline --decorate --grep '<keyword>'
git log --all --oneline --decorate -- <path>
git show <commit>:<path>
git diff upstream/main...HEAD -- <path>
```

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
