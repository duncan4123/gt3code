{{ define "beads-rust-backend" }}

## Beads Rust Backend

This city uses the Gas City exec beads provider:

```toml
[beads]
provider = "exec:/data/projects/gascity/contrib/beads-scripts/gc-beads-br"
```

That wrapper talks to `br` (beads_rust), not Dolt or `bd`.

Use `gc bd` as the stable interface:

```bash
gc bd --rig beads_rust list
gc bd --rig beads_rust show <id> --json
gc bd --rig beads_rust update <id> --set-metadata key=value
```

Backend rules for this city:

- Do not run `gc dolt ...` diagnostics for `beads_rust`; there is no Dolt
  server lifecycle for this rig.
- Do not run bare `bd` in this city. The provider is `br` behind `gc bd`.
- The wrapper runs `br` from `BR_DIR` or `GC_STORE_ROOT`; use `gc bd --rig
  beads_rust ...` so Gas City sets the correct store root.
- Metadata is stored by the wrapper in the `br` SQLite metadata table under
  `issue:<id>:metadata`. Read and write it through `gc bd`, not raw SQLite.
- Parent and dependency edges are represented as backend labels
  `parent:<id>` and `needs:<id>`. Raw `br` may show encoded labels
  (`labelhex:*` or `labelhash:*`); `gc bd` decodes the Gas City view.
- `br` statuses `blocked`, `review`, and `testing` are normalized to `open`
  when Gas City reads them.

If bead commands fail here, collect:

```bash
gc bd --rig beads_rust list --json
BR_DIR={{ .RigRoot }} br info --json
```

Then escalate with that evidence instead of restarting Dolt.
{{ end }}
