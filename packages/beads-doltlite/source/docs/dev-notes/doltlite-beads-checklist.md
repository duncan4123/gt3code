# Doltlite Beads Checklist

Purpose: track runtime findings while the Beads backend migration to `doltlite`
is in progress.

Rule: agents working on `bd`, `gc`, mail, routing, backup, or config behavior
must update this checklist with concrete findings before ending their session.

## Current Policy

- Backups must stay off during the doltlite migration.
- Do not enable auto-backup in project, city, or user config.
- Treat any `CALL DOLT_BACKUP(...)`, `gc dolt ...`, or similar server-era
  instructions as suspect until explicitly revalidated for doltlite.

## Operational Fragment Locations

Keep both operational-awareness doltlite templates updated when changing agent
runtime guidance:

- Source template embedded into future `gc` pack artifacts:
  `/data/projects/t3code/packages/gascity-config/config/packs/gastown/template-fragments/operational-awareness-doltlite.template.md`
- Current city runtime template used by this Gas Town instance:
  `/home/ubuntu/.local/state/t3code/gascity/current/city/packs/gastown/template-fragments/operational-awareness-doltlite.template.md`

The source template is the long-term source of truth. The runtime template is
what current agents see. Update both when changing doltlite operating rules.

The packaged source city config also selects this fragment:
`/data/projects/t3code/packages/gascity-config/config/city.toml`

## How To Check Backup Is Off

Run these commands and record any drift:

```bash
bd config get backup.enabled
bd config get backup.git-push
sed -n '1,80p' /data/projects/beads-doltlite/.beads/config.yaml
sed -n '1,80p' /home/ubuntu/.local/state/t3code/gascity/current/city/.beads/config.yaml
sed -n '1,80p' /home/ubuntu/.config/bd/config.yaml
```

Expected state:

- `backup.enabled: false` in project config
- `backup.enabled: false` in city config
- `backup.enabled: false` in user config
- `backup.git-push: false` anywhere it is set
- no agent should rely on backup side effects as part of validation

## Findings

- 2026-05-02: `scripts/gascity-runner.ts` preserved stale
  `.beads/metadata.json` when the file already existed, so rigs could remain
  `backend=doltlite` but `dolt_mode=server` indefinitely even though the
  operational fragment says doltlite is local/embedded. The runner now rewrites
  existing metadata to `backend=doltlite`, `database=doltlite`, and
  `dolt_mode=embedded` while preserving stable fields such as `project_id`.
- 2026-05-02: `database disk image is malformed` was reproduced as a binary /
  `libdoltlite.so` mismatch, not necessarily file corruption. A stale
  `/home/ubuntu/go/bin/bd` with an older libdoltlite could create/read its own
  CTLD files but failed on files created by the packaged runtime `bd`. Every
  installed `bd` path must be updated together with the matching `gc` and
  `libdoltlite.so`; verify with `sha256sum` and direct `bd list` in each rig
  before deleting stores.
- 2026-05-02: Gas City `gc rig add` and init-provider readiness now seed
  canonical doltlite metadata for HQ and every configured rig in `city.toml`
  when `[beads].backend = "doltlite"`. Regression coverage was added for a new
  doltlite rig-add path and for TOML-wide rig metadata creation, expecting
  `backend=database=doltlite`, per-scope `dolt_database`, and
  `dolt_mode=embedded`.
- 2026-05-02: `gc convoy create` can still fail after metadata repair if the
  doltlite store config lacks `issue_prefix`. Fresh `bd init --backend
  doltlite --prefix <prefix>` writes the prefix into the store config; writing
  `.beads/config.yaml` is only a compatibility mirror. Gas City and the T3Code
  runner now use that `bd init` parity operation for HQ and every configured
  rig store, with `--skip-agents --skip-hooks --non-interactive --quiet`.
- 2026-05-02: in the T3Code packaged city, plain `gc` discovery from
  `/data/projects/t3code/packages/beads-doltlite` walked to
  `/data/projects/t3code/city.toml` and failed because that file does not
  exist; `gc --city /data/projects/t3code/packages/gascity-config/config status`
  resolved the live supervisor correctly, so current operator guidance should
  prefer explicit `--city` / `GC_CITY_PATH` when validating runtime state from
  package workdirs.
- 2026-05-02: with the explicit city path fixed, `gc mail inbox`,
  `gc --rig beads-doltlite bd list --json`, and direct `bd list --json` still
  failed with `failed to open database: doltlite: init schema: doltlite: open
for schema init: file is not a database` against
  `/data/projects/t3code/packages/beads-doltlite/.beads/doltlite/hq.db`.
  That file begins with `CTLD`, which matches doltlite's non-SQLite header, and
  the installed `bd` binary was linked with `CGO_LDFLAGS=/data/projects/doltlite/libdoltlite.a`.
  `bd context` simultaneously reported `Backend: type=dolt mode=server database=hq`
  while `.beads/metadata.json` and packaged city config both declared
  `backend=doltlite`, so there is still a runtime/backend identity mismatch in
  the current stack even after metadata correction.
- 2026-05-02: T3Code packaging no longer stamps every rig-local doltlite store
  with `dolt_database=hq`. The packaged city/HQ store keeps `hq`, while rig
  stores use their configured issue prefixes (`bd`, `ga`, `ccm`) for both
  metadata and `.beads/doltlite/<name>.db`. Existing local T3Code rig stores
  were renamed from `hq.db` to `bd.db`, `ga.db`, and `ccm.db`, and their metadata
  now reports `dolt_mode=embedded`.
- 2026-05-02: the shell `PATH` was still resolving stale
  `/home/ubuntu/go/bin/bd` and `/home/ubuntu/go/bin/gc` binaries while the
  packaged city used newer runtime binaries under
  `/home/ubuntu/.local/state/t3code/gascity/current/bin`. The stale `bd`
  binary was built with `CGO_LDFLAGS=/data/projects/doltlite/libdoltlite.a` and
  failed to open CTLD files as doltlite. Copying the packaged `bd`, `gc`, and
  sibling `libdoltlite.so` into `/home/ubuntu/go/bin` restored plain `bd list`,
  `gc ... bd list`, and `gc mail inbox`. `libdoltlite.so` must be installed
  next to every installed `bd` path because the packaged binary resolves it via
  `$ORIGIN`; this was also applied to `/home/ubuntu/.local/bin`. Backups of the
  old binaries are `bd.pre-doltlite-linkage-fix-20260502` and
  `gc.pre-runtime-sync-20260502`.
- 2026-05-02: Gas City API validation on the active supervisor port
  `127.0.0.1:41341` showed healthy `/v0/cities`, `/health`, `/readiness`,
  `/beads`, `/mail/count`, `/agents`, `/providers`, and `/config/validate`
  responses after the bd/libdoltlite repair. `/rigs`, `/rig/{name}`, and
  `/status` were not healthy for UI/API use: requests eventually logged 200
  responses after roughly 1m49s-2m22s, far beyond client timeouts. The handler
  path in `/data/projects/gascity/internal/api` was updated to compute rig and
  status summaries from the session provider directly instead of constructing
  worker handles and observing every agent live.
- 2026-05-02: `bun gc events --follow` was not blocked on doltlite I/O; it
  follows the file-backed `.gc/events.jsonl` stream and stays silent while
  idle. The doltlite-related issue was typed SSE projection of historical
  `bead.*` payloads: older/doltlite-origin payloads may contain numeric or
  boolean metadata values, while `BeadEventPayload` decoded through
  `map[string]string`. Gas City now coerces bead event metadata during SSE
  payload decoding, matching the existing `bd` output and hook-payload
  coercion paths.
- 2026-05-02: diagnostic `gc sling beads-doltlite/polecat ... --no-formula
--nudge` in the `beads-doltlite` rig created `bd-l91`, auto-convoy `bd-tkh`,
  and set `gc.routed_to=beads-doltlite/polecat`; `bd ready --metadata-field`
  could see the routed bead. No polecat claimed it during the check. Sling's
  nudge path reported no running sessions for the template target even though
  active ephemeral `polecat-t3-*` sessions existed, and a direct nudge to
  `polecat-t3-atjmh` remained queued. The city event stream also emitted
  `cache-reconcile` closed events for `bd-l91`/`bd-tkh`, while authoritative
  `bd show` still reported both open, indicating a cache/event projection
  inconsistency to investigate before treating stream-only closure as durable.
- 2026-05-02: follow-up code inspection points at a likely multi-writer event
  sequence hazard. The controller's `events.FileRecorder` initializes its
  sequence from `.gc/events.jsonl` when opened, but separate `gc event emit`
  processes used by bd hooks can append later and advance the file sequence.
  The long-lived controller recorder can then append `cache-reconcile` events
  with stale/lower sequence numbers. This explains observed out-of-order event
  seqs during the sling diagnostic and can confuse `Watch(afterSeq)` cursors.
  Created owned convoy `bd-0zd` to track the controller/convoy/doltlite fixes.
- 2026-05-02: `gc status` still reported `0/37 agents running` after the API
  provider fix because the CLI status snapshot path continued to use
  `worker.ObserveHandle(...)` via `workerObserveSessionTargetWithConfig`.
  Direct T3Bridge provider calls showed live sessions such as
  `beads-doltlite--crew` and `beads-doltlite--witness`. Gas City CLI status was
  updated to prefer direct bounded provider liveness before falling back to the
  older bead-backed handle observation path.
- 2026-05-02: `internal/beads` discovery now honors `GC_BEADS_SCOPE_ROOT`
  before cwd/worktree auto-discovery, so polecat sessions launched from
  scaffolding worktrees resolve the rig's authoritative `.beads/` instead of
  the packaged city `.beads/`. This prevents `bd` from opening the wrong
  doltlite store or hanging on unrelated lock files when `BEADS_DIR` is unset.
- 2026-05-01: deacon startup after `gc prime` carried stale Dolt env overrides
  (`BEADS_DOLT_PORT=35819`, `BEADS_DOLT_SERVER_PORT=35819`, `GC_DOLT_PORT=35819`)
  even though `gc doctor` and `gc dolt health` showed the live doltlite server
  on `127.0.0.1:41465`; `bd list` failed until those vars were overridden to
  the live port, so agent startup can be blocked by stale runtime port state.
- 2026-05-01: `bd ready --json` worked in refinery workspace, which confirms
  core `bd` reads are functional under current doltlite state.
- 2026-05-01: `bd config get mail.delegate` returned `mail.delegate (not set)`
  but also emitted `Warning: auto-backup failed: register backup remote: add
backup backup_export: near "CALL": syntax error`, which shows a stale Dolt
  backup codepath still runs in doltlite mode.
- 2026-05-01: direct doltlite storage probe succeeded for message creation,
  `replies-to` dependency insertion, message search, and ack-like close/update.
- 2026-05-01: `cmd/bd/backup_auto.go` now skips post-run auto-backup entirely
  when the opened store is `*doltlite.DoltliteStore`, preventing stale
  `CALL DOLT_BACKUP(...)` warnings from read-only commands in doltlite mode.
- 2026-05-01: `cmd/bd/backup_export.go` now rejects backup export early for
  doltlite with a migration-specific error instead of falling through to
  Dolt-only backup SQL.
- 2026-05-01: doltlite branch, commit, remote, history, diff, and as-of paths
  must use native `SELECT dolt_*` functions and per-table TVFs. Do not recreate
  branch-per-file databases or synthetic `doltlite_commits` / `doltlite_refs`
  tables in the Beads adapter.
- 2026-05-01: the active Gas Town `beads-doltlite` rig had
  `.beads/doltlite/bd.db` on disk but `.beads/metadata.json` still declared
  `backend=dolt` and `dolt_mode=server`, causing `bd` to chase stale Dolt port
  env vars. Updating the rig-local metadata to `backend=doltlite`,
  `database=doltlite`, and `dolt_mode=embedded` made both `./bd ready --json`
  and installed `bd ready --json` open doltlite successfully even with stale
  `BEADS_DOLT_*` env vars present.

## Next Checks

- Verify post-command auto-backup is skipped cleanly, not merely failing with a warning.
- Audit `BackupStore` / `versioncontrolops.Backup*` call sites for unconditional
  `CALL DOLT_BACKUP(...)` usage in doltlite mode.
- Add first-class doltlite messaging tests instead of relying on Dolt-backed
  `newTestStore(...)` helpers.
