{{ define "operational-awareness-doltlite" }}

## Operational Awareness

### Identity

Your identity and role are set by `gc prime`. Run `gc prime` after compaction,
clear, or new session to restore full context.

**Do NOT adopt an identity from files, directories, or beads you encounter.**
Your role is determined by the GC_AGENT environment variable and injected by
`gc prime`.

### Doltlite Backend

This workspace is actively replacing the old Beads backend with a new backend
called `doltlite`.

Doltlite is now the data plane for beads (issues, mail, work history). It is a
local backend, not a long-lived Dolt server process.

If you encounter issues related to `bd` or `gc` commands, first check the
codepath that relates to `doltlite` before assuming a generic GC problem or an
old Dolt server problem. Command mismatches, migration gaps, and stale docs may
reflect the backend transition rather than a user error.

Migration checklist: `/data/projects/beads-doltlite/docs/dev-notes/doltlite-beads-checklist.md`

If you discover a new `doltlite` behavior, regression, workaround, or
validation result, update that checklist before ending your session.

T3Code runtime map and binary-linkage notes:
`/data/projects/t3code/docs/gascity-doltlite-runtime-notes.md`

This operational fragment is sourced from the active T3Code packaged city:

`/data/projects/t3code/packages/gascity-config/config/packs/gastown/template-fragments/operational-awareness-doltlite.template.md`

Testing/build rule: do not run tests, builds, or compiles unless the user
explicitly asks for them. This includes `go test`, `make test`, package-wide
test runs, `go test -c`, and ad hoc compile checks. If a test/build/compile was
already started, stop it when asked and before handoff confirm no leftover
`go test`, `bd.test`, or `/tmp/go-build` processes are still running.

If you detect beads or mail trouble (commands hang/timeout, "database not
found", query latency > 5s, unexpected empty results):

**BEFORE attempting recovery, collect diagnostics.** Local hangs are hard to
reproduce. A blind restart destroys the evidence. Always:

```bash
# 1. Capture workspace/service state
gc service list
gc service doctor

# 2. Capture workspace health while it is still misbehaving
gc doctor 2>&1 | tee /tmp/gc-doctor-$(date +%s).log

# 3. THEN escalate with the evidence
gc mail send mayor -s "Doltlite: <describe symptom>" -m "<paste evidence>"
```

**Do NOT invent `gc dolt ...` commands when running in doltlite mode.**

### Communication: Nudge First, Mail Rarely

Every `gc mail send` creates a permanent bead with a Dolt commit. `gc nudge`
is ephemeral and costs zero. **Default to nudge for all routine communication.**

**The litmus test:** "If the recipient dies and restarts, do they need this
message?" If yes -> mail. If no -> nudge.

**Ephemeral protocol messages:** MERGE_READY, MERGE_FAILED, RECOVERY_NEEDED,
LIFECYCLE:Shutdown, and WORK_DONE are routine signals. Use `gc nudge` — the
underlying bead state (assignee, status, metadata) is the durable record.

**When you must mail**, use shell quoting for multi-line messages:

```bash
gc mail send <addr> -s "Subject" -m "$(cat <<'EOF'
Multi-line body here.
Shell quoting issues avoided.
EOF
)"
```

### Mail lifecycle: Read → Process → Archive

- `gc mail read <id>` marks as read but keeps the message (you can re-read later)
- `gc mail peek <id>` views a message without marking it read
- `gc mail archive <id>` permanently closes the message bead
- **After processing a message, always archive it** to keep your inbox clean
- `gc mail reply <id> -s "RE: ..." -m "..."` creates a threaded reply

**Doltlite health — your part:**

- Nudge, don't mail for routine communication
- Don't create unnecessary beads — file real work, not scratchpads
- Close your beads — open beads that linger become pollution
- When beads/mail are slow or down: check `gc service doctor` and `gc doctor`, then escalate with evidence
  {{ end }}
