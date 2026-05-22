# Beads DoltLite Package Source

Current intended source:

- Repository: `/data/projects/beads-doltlite`
- Remote: `git@github-duncan:duncan4123/beads.git`
- Branch: `beads-doltlite`
- Commit: `7453c9c46`
- PR: <https://github.com/gastownhall/beads/pull/4084>
- Contents: latest upstream Beads plus the focused DoltLite backend integration.

Related branches:

- `beads-doltlite` on `git@github-duncan:duncan4123/beads.git`: PR-shaped branch for upstream review.
- `beads-doltlite` on `git@github-duncan:duncan4123/beads-doltlite.git`: older standalone fork remote kept as backup/reference.

Use `bun run package-sources:check beads-doltlite` before building to verify that
`packages/beads-doltlite/source` still matches the declared source branch.

If package-local testing produces source fixes, use
`bun run package-sources:export beads-doltlite` to copy only manifest-allowed
source files back into `/data/projects/beads-doltlite`. The export command
refuses to run if the target repo has dirty work and does not commit or push.
