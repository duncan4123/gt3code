{{ define "jj-workflow" }}

## Jujutsu Workflow

When the repo has `.jj/`, treat Jujutsu state as first-class:

- Check `jj status` in addition to `git status` before handoff.
- If you used Git commands, run `jj status` afterward so JJ imports the Git
  view before you report clean state.
- Do not assume a clean Git tree means JJ is clean; line-ending/filter churn can
  appear in one tool before the other.
- For stacked work, keep changes small and describe each logical change with
  `jj describe`.
- For Git-hosted remotes, push normal bookmarks/branches. For Jorje review
  stacks, prefer `jj git push -c <rev>` when creating change review refs.
- Do not abandon, restore, rebase, or rewrite other agents' changes unless the
  human explicitly asks for that operation.

If `jj` is unavailable, continue with Git and note that JJ verification was not
run.
{{ end }}
