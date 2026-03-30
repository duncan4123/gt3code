Title: Doltlite corrupts `:memory:` DB on repeated `INSERT ... ON CONFLICT DO UPDATE` with insert-side subquery inside one open transaction

Summary

Doltlite appears to corrupt a fresh in-memory database during a long-lived write transaction when the same row is upserted twice using `INSERT ... ON CONFLICT DO UPDATE`, if the `VALUES` clause contains a subquery that reads from the target table.

Observed error:

`SqliteError: database disk image is malformed`

Environment

- Doltlite repo: `/data/projects/doltlite`
- Repro discovered on 2026-03-30
- Database: `:memory:`
- WAL enabled
- No persisted DB file involved

What does and does not fail

Works:

- `INSERT`, then `UPDATE` of the same row in one transaction
- simple `INSERT ... ON CONFLICT DO UPDATE` of the same row in one transaction
- upsert, then insert of a different primary key in one transaction

Fails:

- repeated upsert of the same row in one transaction when the insert-side `VALUES` expression includes:

```sql
COALESCE(
  @attachments_json,
  (
    SELECT attachments_json
    FROM projection_thread_messages
    WHERE message_id = @message_id
  )
)
```

Narrowing

The failure does not require:

- FTS5
- app-level orchestration
- existing on-disk corruption

The smallest failing shape found so far is:

1. Create a table with a primary key and nullable `attachments_json`
2. `BEGIN IMMEDIATE TRANSACTION`
3. Run the upsert once for `message_id = 'assistant:item-1'`
4. Run the same upsert again for the same `message_id`
5. Second statement fails with `SQLITE_CORRUPT`

Minimal repro

This is the smallest failing SQL shape we isolated:

```sql
CREATE TABLE projection_thread_messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  turn_id TEXT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  is_streaming INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attachments_json TEXT
);

BEGIN IMMEDIATE TRANSACTION;

INSERT INTO projection_thread_messages (
  message_id,
  thread_id,
  turn_id,
  role,
  text,
  attachments_json,
  is_streaming,
  created_at,
  updated_at
)
VALUES (
  @message_id,
  @thread_id,
  @turn_id,
  @role,
  @text,
  COALESCE(
    @attachments_json,
    (
      SELECT attachments_json
      FROM projection_thread_messages
      WHERE message_id = @message_id
    )
  ),
  @is_streaming,
  @created_at,
  @updated_at
)
ON CONFLICT (message_id)
DO UPDATE SET
  thread_id = excluded.thread_id,
  turn_id = excluded.turn_id,
  role = excluded.role,
  text = excluded.text,
  attachments_json = excluded.attachments_json,
  is_streaming = excluded.is_streaming,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
```

Then execute it twice in the same open transaction with:

```text
@message_id = 'assistant:item-1'
@thread_id = 'thread-1'
@turn_id = 'turn-1'
@role = 'assistant'
@text = 'buffer me'
@attachments_json = NULL
@is_streaming = 1 on first call, 0 on second call
@created_at = same timestamp
@updated_at = same timestamp
```

Actual result

- first execution succeeds
- second execution fails with `database disk image is malformed`

Expected result

- second execution should either update the row normally or return a regular constraint/runtime error
- it should not corrupt the database

Additional narrowing

This variant succeeds:

```sql
INSERT INTO projection_thread_messages (...)
VALUES (@message_id, ..., @attachments_json, ...)
ON CONFLICT (message_id)
DO UPDATE SET
  attachments_json = excluded.attachments_json,
  ...
```

This also succeeds:

- first `INSERT`
- second plain `UPDATE`

So the likely trigger is the insert-side subquery against the target table on the repeated upsert/conflict path.

Repro script

Repo-local repro script:

- [apps/server/scripts/repro-doltlite-turn-tx.mjs](/data/projects/t3code/apps/server/scripts/repro-doltlite-turn-tx.mjs)

Suggested investigation area

Likely areas in Doltlite:

- upsert/conflict handling during an open write transaction
- self-referential subqueries against the target table in `VALUES (...)`
- recent savepoint / deferred-write / MutMap structural-sharing work

Potentially relevant recent commits:

- `938c41a33` `Use structural sharing for savepoint instead of MutMap cloning (#226)`
- `1d2002984` `Defer MutMap flush for all tables including ephemeral (#219)`
