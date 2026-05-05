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

Direct shell commands inside a polecat worktree can also inherit stale managed
Dolt variables from the parent process. If `GC_CITY_PATH` is empty but ambient
`GC_DOLT_PORT`, `BEADS_DOLT_PORT`, or `BEADS_DOLT_SERVER_*` are still set,
plain `bd ...` can dial a dead Dolt server instead of using the city's
doltlite store. Prefer `node scripts/gascity-runner.ts ...` or `gc bd ...`
when validating the packaged runtime, and make sure startup helpers strip stale
`GC_DOLT_*`, `BEADS_DOLT_*`, and `DOLT_*` variables.

## 2026-05-06 HQ Polecat Audit

Manual-origin HQ polecat work discovery has two separate failure modes, and the
shell you audit from matters:

- Tool shells in a polecat worktree may expose stale Dolt coordinates without
  the live session identity. In this audit, the shell only had
  `GC_WORKTREES_DIR` plus a dead `GC_DOLT_PORT`, so plain `bd list` tried to
  dial an unreachable Dolt server.
- `gc session audit-env` showed the live projected session metadata for
  `gastown__hq-polecat-t3-5o199vjs` still carried
  `GC_SESSION_NAME=gastown__hq-polecat-t3-5o199vjs`,
  `GC_AGENT=gastown.hq-polecat-2`, and
  `GC_TEMPLATE=gastown.hq-polecat`.

Repro notes:

```bash
env GC_SESSION_NAME='gastown__hq-polecat-t3-5o199vjs' \
    GC_AGENT='gastown.hq-polecat-2' \
    gc hook
# -> gc hook: agent "gastown.hq-polecat-2" not found in config

env GC_SESSION_NAME='gastown__hq-polecat-t3-5o199vjs' \
    GC_AGENT='gastown.hq-polecat-2' \
    GC_TEMPLATE='gastown.hq-polecat' \
    gc hook
# -> routed pool work becomes visible again
```

That confirms manual or projected sessions with instance-style `GC_AGENT`
values depend on `GC_TEMPLATE` for config lookup. Current source already has a
regression test for the intended manual-session behavior in
`packages/gascity/source/cmd/gc/cmd_hook_test.go`.

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
