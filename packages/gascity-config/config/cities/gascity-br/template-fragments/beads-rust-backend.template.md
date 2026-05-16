{{ define "beads-rust-backend" }}

## Beads Rust Backend

This city uses the Gas City exec beads provider:

```toml
[beads]
provider = "exec:gc-beads-br"
```

That wrapper talks to `br` (beads_rust), not Dolt or `bd`.

Use `br` directly for bead work:

```bash
BR_ROOT="${GC_RIG_ROOT:-{{ .RigRoot }}}"
BR_DB="$BR_ROOT/.beads/beads.db"
br --db "$BR_DB" --actor "${GC_SESSION_NAME:-${GC_AGENT:-agent}}" list
br --db "$BR_DB" --actor "${GC_SESSION_NAME:-${GC_AGENT:-agent}}" --json show <id>
br --db "$BR_DB" --actor "${GC_SESSION_NAME:-${GC_AGENT:-agent}}" --json gc-metadata get <id>
printf '{"key":"value"}' | br --db "$BR_DB" --actor "${GC_SESSION_NAME:-${GC_AGENT:-agent}}" gc-metadata set <id>
```

For repeated work, define helpers in the current shell:

```bash
BR_ROOT="${GC_RIG_ROOT:-{{ .RigRoot }}}"
BR_DB="$BR_ROOT/.beads/beads.db"
BR_ACTOR="${GC_SESSION_NAME:-${GC_AGENT:-agent}}"
brj() { br --db "$BR_DB" --actor "$BR_ACTOR" --json "$@"; }
brt() { br --db "$BR_DB" --actor "$BR_ACTOR" "$@"; }
brlist() { brj list "$@" | jq -c '.issues // .'; }
brmeta() { br --db "$BR_DB" --actor "$BR_ACTOR" --json gc-metadata "$@"; }
brmeta_set() { local id="$1" key="$2" value="$3"; brmeta get "$id" | jq --arg k "$key" --arg v "$value" '. + {($k): $v}' | br --db "$BR_DB" --actor "$BR_ACTOR" gc-metadata set "$id"; }
brmeta_unset() { local id="$1" key="$2"; brmeta get "$id" | jq --arg k "$key" 'del(.[$k])' | br --db "$BR_DB" --actor "$BR_ACTOR" gc-metadata set "$id"; }
```

Backend rules for this city:

- Do not run `gc dolt ...` diagnostics for `beads_rust`; there is no Dolt
  server lifecycle for this rig.
- Do not run bare `bd` in this city. Use `br` against the configured
  `beads_rust` rig DB.
- The wrapper runs `br` from `BR_DIR` or `GC_STORE_ROOT`; for direct work,
  set `BR_DB="$GC_RIG_ROOT/.beads/beads.db"` or run from the rig root.
- Metadata is stored by the wrapper in the `br` SQLite metadata table. Read
  and write it through `br gc-metadata`, not raw SQLite.
- Parent and dependency edges are represented as backend labels
  `parent:<id>` and `needs:<id>`. Raw `br` may show encoded labels
  (`labelhex:*` or `labelhash:*`); the Gas City wrapper decodes those when it
  has to read the backend.
- `br` statuses `blocked`, `review`, and `testing` are normalized to `open`
  when Gas City reads them.

If bead commands fail here, collect:

```bash
BR_DB="${GC_RIG_ROOT:-{{ .RigRoot }}}/.beads/beads.db" br --json list
BR_DB="${GC_RIG_ROOT:-{{ .RigRoot }}}/.beads/beads.db" br --json info
```

Then escalate with that evidence instead of restarting Dolt.
{{ end }}
