# Gas City, doltlite, and T3Code Runtime Notes

This note records the local moving parts for the T3Code `ship` branch Gas City
runtime and the `beads-doltlite` migration work. It exists because the same
names appear in several places: source trees, materialized runtime trees,
installed binaries, Beads metadata, and provider sessions.

## Main Locations

| Purpose                         | Path                                                      |
| ------------------------------- | --------------------------------------------------------- |
| T3Code repo                     | `/data/projects/t3code`                                   |
| Gas City source repo            | `/data/projects/gascity`                                  |
| Beads doltlite source repo      | `/data/projects/beads-doltlite`                           |
| Doltlite source/build artifacts | `/data/projects/doltlite`                                 |
| T3Code GC runtime home          | `/home/ubuntu/.local/state/t3code/gascity/current`        |
| Active T3Code city config       | `/data/projects/t3code/packages/gascity-config/config`    |
| Runtime `gc` binary             | `/home/ubuntu/.local/state/t3code/gascity/current/bin/gc` |
| Installed global `bd`           | `/home/ubuntu/go/bin/bd`                                  |

The repo-owned config that T3Code ships and uses in development lives under:

```text
/data/projects/t3code/packages/gascity-config/config
```

Runtime-local process state and the copied `gc` binary live under:

```text
/home/ubuntu/.local/state/t3code/gascity/current
```

The active city Beads metadata currently selects doltlite:

```text
/data/projects/t3code/packages/gascity-config/config/.beads/metadata.json
```

```json
{
  "database": "doltlite",
  "backend": "doltlite",
  "dolt_database": "hq"
}
```

Patch `packages/gascity-config/config` for city behavior. The runtime home is
for binaries, supervisor/process state, and other machine-local files.

## HQ Polecat Manual-Origin Routed Work Audit

On 2026-05-06, `t3-arx.4` audited how HQ polecats discover routed work from a
manual shell. The result is: generic routed pool discovery is intentionally
blocked for `GC_SESSION_ORIGIN=manual`.

Relevant code paths:

- `packages/gascity/source/internal/config/config.go`:
  `Agent.EffectiveWorkQuery()` checks exact continuity first
  (`GC_SESSION_ID`, `GC_SESSION_NAME`, `GC_ALIAS`), then only enters the
  generic `gc.routed_to=<target>` tier when `GC_SESSION_ORIGIN` is
  `ephemeral` or empty.
- `packages/gascity/source/cmd/gc/cmd_hook.go`:
  `gc hook` preserves `GC_SESSION_ORIGIN` for session-context execution, so a
  manual-origin session keeps `origin=manual` all the way into the work query.
- `packages/gascity/source/engdocs/design/session-model-unification.md`:
  manual sessions are not generic capacity. They resume only through exact
  continuity handles or direct targeting.

Practical consequence for HQ polecats:

- A manual session shell should not expect plain `gc hook` to expose unassigned
  `gc.routed_to=gastown.hq-polecat` work.
- Recovery and operator probes should inspect the pool explicitly from the city
  config root, for example:

```bash
bd ready --metadata-field gc.routed_to=gastown.hq-polecat --unassigned --json --limit=1
```

Observed local wrinkle during the audit:

- `bd` from the polecat worktree attempted to use a stale Dolt endpoint and
  failed with `Dolt server unreachable at 127.0.0.1:35819`.
- The worktree-local `.beads/metadata.json` still declared
  `backend=dolt`, `database=dolt`, `dolt_mode=server`, `dolt_database=t3`,
  and the worktree-local `.beads/config.yaml` still pinned
  `dolt.host: 127.0.0.1` and `dolt.port: 35819`.
- The same `bd` query from `/data/projects/t3code/packages/gascity-config/config`
  succeeded, where `.beads/metadata.json` declared `backend=doltlite`,
  `database=doltlite`, and `dolt_mode=embedded`, and `gc doctor` reported the
  HQ and rig stores healthy.

This means the manual-origin work-discovery question is separate from the
worktree-local Beads runtime mismatch: routed work exists, but manual sessions
still do not consume generic pool demand through `gc hook`, and this specific
worktree was also carrying an outdated Beads store snapshot.

## T3Bridge Session Bead Lifecycle Audit

On 2026-05-06, `t3-arx.2` audited how T3 bridge session lifecycle behavior
interacts with the active doltlite Beads backend.

Source paths reviewed:

- `packages/gascity/source/internal/runtime/t3bridge/provider.go`
- `packages/gascity/source/internal/runtime/t3bridge/provider_test.go`
- `packages/gascity/source/internal/beads/doltlite_read_store.go`
- `packages/contracts/src/gc.ts`
- `docs/convoy-lifecycle-walkthrough.md`

Current lifecycle shape:

- Session beads remain the durable runtime identity in the HQ city store.
- T3 bridge thread metadata projects session identity via `gc.sessionName`,
  agent/rig/city identity via `gc.*`, and current work assignment via
  `gc.bead`, `gc.beadTitle`, convoy counts, molecule, and formula.
- `Start(...)` emits `gc.session.started` for fresh threads and
  `gc.session.reused` when rebinding an existing thread.
- Work-assignment updates do not come from the session bead itself. They come
  from `runEventWatcher(...)`, which watches Beads events and refreshes thread
  metadata/activity when the current work bead changes state.
- In doltlite mode, that watcher prefers
  `internal/beads.NewDoltliteReadStore(...)` for hot in-process reads and falls
  back to `BdStore` only if direct doltlite open fails.

Important audit finding:

- `buildThreadEnv(...)` still forwards `GC_DOLT_HOST` / `GC_DOLT_PORT` into
  `BEADS_DOLT_SERVER_*` thread env keys.
- In this workspace, running `bd` from the polecat worktree failed with the
  stale endpoint `127.0.0.1:35819`, but the stronger confirmed cause was
  worktree-local Beads metadata drift: the worktree snapshot still declared a
  Dolt server store while the authoritative city root was already doltlite.
- That means one real lock/open hazard is config-root ambiguity: a session or
  shell that resolves Beads relative to the worktree can open the wrong store
  before T3 bridge fallback logic even matters.
- The watcher is partly insulated because it first tries
  `NewDoltliteReadStore(...)`, but if that direct open path ever fails, its
  fallback `BdStore` path can still be vulnerable to stale server-era env if
  the discovered store metadata and thread env disagree.

Practical consequence:

- Fresh/reused T3 bridge sessions can still bind and surface `gc.session*`
  lifecycle correctly.
- The fragile point under doltlite is assignment projection refresh after
  startup, especially if Beads discovery lands on a worktree-local stale store
  or if fallback reads honor stale Dolt server env.
- Symptoms would look like live session threads that stay open but stop
  updating `gc.bead`, `gc.beadTitle`, convoy counts, or
  `gc.bead.claimed` / `gc.bead.closed` activity after work transitions.

Recommended follow-up:

- Treat worktree-local `.beads` metadata drift as a first-class doltlite
  lifecycle risk, not just a shell ergonomics issue.
- Treat stale `GC_DOLT_*` / `BEADS_DOLT_SERVER_*` values in T3 bridge thread
  env as an additional risk when fallback reads use `BdStore`.
- Prefer clearing or ignoring those server-only vars when the discovered Beads
  store metadata says `backend=doltlite`, and prefer anchoring Beads discovery
  to the authoritative city/rig root instead of a transient worktree snapshot.
- If a future fix changes this behavior, update both this note and the
  migration checklist with the exact direct-open and fallback-read results.

## Running the Bundled Runtime

Use T3Code's runner for the packaged city:

```bash
node scripts/gascity-runner.ts path
node scripts/gascity-runner.ts gc status
node scripts/gascity-runner.ts gc session list
```

`bun gc ...` wraps the same runner.

Do not compare this with raw `gc status` from an arbitrary directory. Raw `gc`
uses normal Gas City discovery, while the runner passes:

```text
--city /data/projects/t3code/packages/gascity-config/config
GC_HOME=/home/ubuntu/.local/state/t3code/gascity/current
GC_CITY_PATH=/data/projects/t3code/packages/gascity-config/config
GC_BIN=/home/ubuntu/.local/state/t3code/gascity/current/bin/gc
```

## Binary Version Skew

`gc status` and `gc session list` can disagree if the materialized runtime is
using an older `gc` binary than the Gas City source branch being debugged.

Check the binary actually used by T3Code:

```bash
go version -m /home/ubuntu/.local/state/t3code/gascity/current/bin/gc
```

During the 2026-05-01 investigation, the materialized binary was still built
from Gas City commit `451b20cd`, while the source branch
`/data/projects/gascity` had newer commits ending at `d1532499`. That explains
a status mismatch where:

- `gc status` reported controller-managed agents as `stopped`.
- `gc session list` saw live T3 bridge provider sessions as `ready`.

The newer Gas City commits had not been installed into the T3Code runtime yet.

## Rebuilding `gc` for doltlite

If Gas City uses the in-process `DoltliteReadStore` optimization, `gc` must be
built with doltlite linkage. Otherwise `gc` falls back to subprocess `bd` for
correctness, but direct reads cannot open `CTLD` doltlite files.

Build from `/data/projects/gascity`:

```bash
CGO_ENABLED=1 \
CGO_CFLAGS="-I/data/projects/doltlite" \
CGO_LDFLAGS="/data/projects/doltlite/libdoltlite.a -lz -lpthread -lm" \
go build -tags libsqlite3 \
  -ldflags "$(git describe --tags --always --dirty 2>/dev/null | sed 's/.*/-X main.Build=&/')" \
  -o ./build/gc ./cmd/gc
```

Verify:

```bash
go version -m /data/projects/gascity/build/gc | rg 'libsqlite3|CGO|libdoltlite|vcs'
```

Expected build metadata includes:

```text
build -tags=libsqlite3
build CGO_ENABLED=1
build CGO_CFLAGS=-I/data/projects/doltlite
build CGO_LDFLAGS="/data/projects/doltlite/libdoltlite.a -lz -lpthread -lm"
```

## Installing a Rebuilt `gc`

Install through the T3Code runner:

```bash
GASCITY_BINARY=/data/projects/gascity/build/gc \
node scripts/gascity-runner.ts install
```

If this fails with:

```text
ETXTBSY: text file is busy, open '<runtime>/bin/gc'
```

then the controller or another `gc` process is still executing the materialized
binary. Do not overwrite it in place. First stop or suspend the runtime, verify
no process is executing that binary, then rerun install.

Useful checks:

```bash
pgrep -af '/home/ubuntu/.local/state/t3code/gascity/current/bin/gc'
node scripts/gascity-runner.ts gc status
node scripts/gascity-runner.ts gc session list
```

If `node scripts/gascity-runner.ts stop` hangs, do not continue to overwrite
the binary. Investigate the controller/session state first.

On 2026-05-01, a failed install hit `ETXTBSY` while replacing
`/home/ubuntu/.local/state/t3code/gascity/current/bin/gc`. The install had
already refreshed the packaged runtime config before the binary copy failed.
After that:

- `/home/ubuntu/.local/state/t3code/gascity/current/cities.toml` contained
  `cities = []`, so `gc status` treated the city as unregistered.
- `/home/ubuntu/.local/state/t3code/gascity/current/city/city.toml` was back to
  the packaged base config with no `beads-doltlite` rig declaration.
- `/home/ubuntu/.local/state/t3code/gascity/current/city/.gc/site.toml` still
  contained the `beads-doltlite` path binding, but `.gc/site.toml` is only a
  machine-local path binding for rigs declared in `city.toml`; it does not
  create a rig by itself.
- `/home/ubuntu/.local/state/t3code/gascity/current/supervisor.sock` still
  answered `ping` with PID 439, so a live supervisor process can coexist with a
  registry/config state that makes `gc status` report `Controller: stopped`.

If this exact shape appears, do not treat it as a doltlite linkage failure. It
is runtime registration/config drift caused by a partial install or stop path.

## Beads, bd, and doltlite

The `beads-doltlite` workspace uses `bd` with the doltlite backend:

```json
{
  "database": "doltlite",
  "backend": "doltlite"
}
```

The active database file is:

```text
/data/projects/beads-doltlite/.beads/doltlite/bd.db
```

It is not a stock SQLite database. Its header starts with `CTLD`, and stock
`sqlite3` reports `file is not a database`.

The installed `bd` binary must be linked against doltlite:

```bash
go version -m "$(command -v bd)" | rg 'libsqlite3|CGO|libdoltlite|vcs'
```

Expected installed `bd` metadata includes:

```text
build -tags=libsqlite3
build CGO_ENABLED=1
build CGO_CFLAGS=-I/data/projects/doltlite
build CGO_LDFLAGS="/data/projects/doltlite/libdoltlite.a -lz -lpthread -lm"
```

With those flags, a Go process using `github.com/mattn/go-sqlite3` can query
the real database:

```sql
SELECT doltlite_engine();        -- prolly
SELECT COUNT(*) FROM dolt_log;   -- works
SELECT name FROM dolt_branches;  -- works
```

Without those flags, the same Go code uses bundled stock SQLite and fails with:

```text
no such function: dolt_commit
no such function: doltlite_engine
```

That failure means the process is linked wrong. It does not mean doltlite lacks
the native `dolt_*` SQL surface.

## Do Not Run `bd dolt push` Here

For the T3Code packaged city and `beads-doltlite`, do not run:

```bash
bd dolt push
bd dolt pull
```

Those commands are for server-mode Dolt stores. The doltlite workspace uses
normal `bd` commands for issue updates and Git for source-code handoff.

This was corrected in:

```text
/data/projects/beads-doltlite/AGENTS.md
/data/projects/beads-doltlite/AGENT_INSTRUCTIONS.md
```

## Gas City Direct Reads vs bd Subprocesses

Gas City's normal `BdStore` shells out to `bd`:

- `bd show --json`
- `bd list --json`
- `bd ready --json`
- `bd dep list --json`
- `bd create/update/close`

The newer Gas City branch also has an optional in-process
`internal/beads/DoltliteReadStore` for hot read paths:

- `Get`
- `List`
- `Ready`
- `PoolDemandCount`
- `DefaultWorkQueryHasReadyWork`
- dependency reads

`openBdStoreAt` tries to construct `DoltliteReadStore`; if it fails, it falls
back to the subprocess `BdStore`. Therefore:

- Correctness only requires `bd` to be linked with doltlite.
- The fast direct-read path requires `gc` itself to be linked with doltlite.

## CLI Output Mismatch Checklist

When `gc status` and `gc session list` disagree:

1. Confirm which binary the T3Code runner is using:
   ```bash
   node scripts/gascity-runner.ts path
   go version -m /home/ubuntu/.local/state/t3code/gascity/current/bin/gc
   ```
2. Compare it with the Gas City source branch:
   ```bash
   git -C /data/projects/gascity log --oneline --decorate -5
   ```
3. Confirm provider sessions are real:
   ```bash
   node scripts/gascity-runner.ts gc session list
   ```
4. Check runtime registration and rig declaration:
   ```bash
   cat /home/ubuntu/.local/state/t3code/gascity/current/cities.toml
   grep -n 'beads-doltlite' /home/ubuntu/.local/state/t3code/gascity/current/city/city.toml
   cat /home/ubuntu/.local/state/t3code/gascity/current/city/.gc/site.toml
   ```
5. If the runtime binary is old, rebuild and install `gc` with the doltlite
   flags above.
6. If install reports `ETXTBSY`, stop/suspend the runtime and verify no process
   is still executing `<runtime>/bin/gc` before retrying.
