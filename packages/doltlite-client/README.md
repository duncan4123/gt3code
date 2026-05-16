# @t3tools/doltlite-client

Small libdoltlite-backed CLI/client for inspecting T3 and Gas City doltlite databases directly by path.

Build:

```sh
bun --filter @t3tools/doltlite-client build
```

Examples:

```sh
bunx --bun dlite info packages/gascity-config/config/.beads/doltlite/hq.db --json
bunx --bun dlite log packages/gascity-config/config/.beads/doltlite/hq.db --limit 10
bunx --bun dlite tables /data/projects/gascity/.beads/doltlite/ga.db --json
bunx --bun dlite query /data/projects/beads-doltlite/.beads/doltlite/bd.db 'SELECT count(*) AS issue_count FROM issues' --json
bunx --bun dlite exec /tmp/example.db 'CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT)'
bunx --bun dlite script /tmp/example.db ./quickstart.sql --json
```

`script` keeps a single database connection open for the whole file, which is required for doltlite session state such as `dolt_config` and `dolt_checkout`.
