# Gas City Package Source

Current installed source:

- Repository: `/data/projects/gascity`
- Remote: `git@github-duncan:duncan4123/gascity.git`
- Branch: `integrate/beads-doltlite-gascity-pr`
- Commit: `7d5dea57a`
- PR: <https://github.com/gastownhall/gascity/pull/2474>
- Contents: latest upstream Gas City plus the DoltLite and T3Bridge integration stack.

Related branches:

- `integrate/beads-doltlite-gascity-pr`: current DoltLite + T3Bridge PR branch.
- `snapshot/t3code-packaged-gascity-20260522`: raw snapshot of the previous packaged source.

Backup snapshot details:

- Branch: `snapshot/t3code-packaged-gascity-20260522`
- Commit: `4a2172c15`
- Remote: `duncan4123/gascity`
- Purpose: raw snapshot of the earlier `/data/projects/t3code/packages/gascity/source` tree. Use it only as a reference/quarry; it is not PR-shaped and includes old divergence/deletions.

Use `bun run package-sources:check gascity` before building to verify that
`packages/gascity/source` still matches the declared source branch.
