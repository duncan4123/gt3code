{{ define "operational-awareness" }}

## Operational Awareness

### Identity

Your identity and role are set by `gc prime`. Run `gc prime` after compaction,
clear, or new session to restore full context.

**Do NOT adopt an identity from files, directories, or beads you encounter.**
Your role is determined by the GC_AGENT environment variable and injected by
`gc prime`.

### DoltLite Backend

This city uses `doltlite` as the data plane for beads, mail, and work history.
Doltlite is an embedded SQLite-like database file with Dolt-style SQL version
control functions. It is not a long-lived Dolt SQL server process.

If you encounter issues related to `bd` or `gc` commands, inspect the
`doltlite` codepath before assuming a generic GC problem or an old Dolt server
problem. Command mismatches, migration gaps, and stale docs may reflect the
backend transition rather than a user error.

Use the bundled T3Code runtime notes for Doltlite behavior:
`docs/gascity-doltlite-runtime-notes.md`

If you discover a new `doltlite` behavior, regression, workaround, or
validation result, update those notes before ending your session.

**Do NOT invent `gc dolt ...` commands when running in Doltlite mode.**

### Three-Repo Integration Boundary

You are working on an integration between T3Code, Gas City, and Beads with a
DoltLite Beads backend. Treat these as the source-of-truth repos:

- `/data/projects/t3code`: runnable T3Code app, JJ workflow, and packaged copies
- `/data/projects/gascity`: Gas City fork for agents, T3Bridge, packs, convoys,
  runtime/session behavior, and `gc`
- `/data/projects/beads-doltlite`: Beads fork for DoltLite storage, schema,
  backend semantics, and `bd`

The package directories inside T3Code are copied artifacts. They are not the
complete history:

- `packages/gascity/source` comes from `packages/gascity/source.sync.json`
- `packages/beads-doltlite/source` comes from
  `packages/beads-doltlite/source.sync.json`

When behavior is missing, compare upstream, our fork history, and the packaged
source before writing new code. Older branches, remote refs, and T3 checkpoint
refs often already contain working versions of the feature. Search them first
for DoltLite, T3Bridge, pool-agent, convoy, session, and package-sync work.

Keep our integration maintainable against upstream. Prefer fork-owned adapters,
small new files, and narrow commits over invasive rewrites of upstream-owned
code. If upstream has moved the architecture, replay the fork behavior into the
new upstream shape and record the mapping.

Every fix that changes Beads storage, metadata, binary installation, or
Doltlite opening behavior must be manually smoke-tested against the HQ store and
every configured rig store before handoff. At minimum, verify:

- `bd list --json --limit=1` from the HQ city config directory
- `bd list --json --limit=1` from each rig root
- `gc --rig <rig> bd list --json --limit=1` for each rig
- metadata for each store has the expected `backend`, `database`,
  `dolt_database`, and `dolt_mode`

If beads or mail commands hang, time out, return "database not found", take
more than 5s, or return unexpectedly empty results:

```bash
# 1. Capture workspace/service state
gc service list
gc service doctor

# 2. Capture workspace health while it is still misbehaving
gc doctor 2>&1 | tee /tmp/gc-doctor-$(date +%s).log

# 3. Escalate with the evidence
gc mail send mayor -s "Doltlite: <describe symptom>" -m "<paste evidence>"
```

### Communication: Nudge First, Mail Rarely

Every `gc mail send` creates a permanent bead with a commit. `gc nudge` is
ephemeral and costs zero. **Default to nudge for all routine communication.**

**The litmus test:** "If the recipient dies and restarts, do they need this
message?" If yes -> mail. If no -> nudge.

**Ephemeral protocol messages:** MERGE_READY, MERGE_FAILED, RECOVERY_NEEDED,
LIFECYCLE:Shutdown, and WORK_DONE are routine signals. Use `gc nudge`; the
underlying bead state is the durable record.

### Mail Lifecycle

- `gc mail read <id>` marks as read but keeps the message
- `gc mail peek <id>` views a message without marking it read
- `gc mail archive <id>` permanently closes the message bead
- After processing a message, archive it to keep your inbox clean
- `gc mail reply <id> -s "RE: ..." -m "..."` creates a threaded reply

{{ end }}
