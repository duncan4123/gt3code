---
name: context-mode
description: |
  Default to context-mode for commands that may produce large output or require analysis.
  Use ctx_execute, ctx_execute_file, ctx_batch_execute, ctx_fetch_and_index, and ctx_search
  instead of Bash/cat for logs, tests, diffs, API responses, docs, snapshots, and large files.
  Prefer named databases for repeatable investigations. Bash stays limited to small-output
  file mutations, git writes, navigation, and other guaranteed-safe commands.
---

# Context Mode: Default for All Large Output

## MANDATORY RULE

<context_mode_logic>
<mandatory_rule>
Default to context-mode for ALL commands. Only use Bash for guaranteed-small-output operations.
</mandatory_rule>
</context_mode_logic>

Bash whitelist (safe to run directly):

- **File mutations**: `mkdir`, `mv`, `cp`, `rm`, `touch`, `chmod`
- **Git writes**: `git add`, `git commit`, `git push`, `git checkout`, `git branch`, `git merge`
- **Navigation**: `cd`, `pwd`, `which`
- **Process control**: `kill`, `pkill`
- **Package management**: `npm install`, `npm publish`, `pip install`
- **Simple output**: `echo`, `printf`

**Everything else -> `ctx_execute` or `ctx_execute_file`.** Any command that reads, queries, fetches, lists, logs, tests, builds, diffs, inspects, or calls an external service.

## Database Default

- Omitting `database` uses the default per-project knowledge base for the current repo.
- Use a **named database** for any investigation you want to replay, branch, diff, or share across restarts.
- Treat the default per-project store as shared project state. Treat named DBs as isolated workspaces for durable research.

## MCP Launcher Source Of Truth

- If an agent is running the wrong `context-mode`, check project/global MCP config files first.
- This pack does not hardcode a machine-local launcher path. Use the context-mode MCP server configured for the current clone/user.
- After changing MCP config, restart the client/agent and run `ctx_doctor` to confirm the expected build is live.

## Decision Tree

- Large output or uncertain output -> use context-mode.
- Web docs -> `ctx_fetch_and_index` then `ctx_search`.
- File analysis -> `ctx_execute_file`.
- Repeatable investigation -> use a named database.

## Tool Order

1. `ctx_batch_execute`
2. `ctx_search`
3. `ctx_execute` / `ctx_execute_file`
4. `ctx_fetch_and_index`
5. `ctx_index`

## Search Rules

- Batch search questions in one `ctx_search(queries: [...])` call.
- Use `source` when multiple docs are indexed.
- Use 2-4 specific technical terms per query.

## Automatic Triggers

Use context-mode automatically for:

- API debugging
- log analysis
- test runs
- git history and diffs
- data inspection
- infrastructure inspection
- dependency audits
- build output
- code metrics
- web docs lookup

## Language Selection

- `javascript` for HTTP/API/JSON
- `python` for analysis
- `shell` for command pipelines and native tools

## Critical Rules

1. Always print findings to stdout.
2. Analyze before printing; do not dump raw blobs.
3. Be specific.
4. Use normal file reads for files you need to edit.
5. Prefer context-mode over shell except for the small-output whitelist.
6. Prefer `ctx_index(path: ...)` over `ctx_index(content: ...)` for large inputs.

## Sandboxed Data Workflow

LargeDataTool(filename: \"path\") -> `ctx_index(path: \"path\")` -> `ctx_search(...)`
