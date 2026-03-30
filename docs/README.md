# Pipeline DB

`pipeline.sqlite` is a **doltlite** database (not standard SQLite). Read it with the doltlite CLI:

```bash
/data/projects/doltlite/build/doltlite docs/pipeline.sqlite
```

## At session start

```sql
-- Check which branch you're on and switch to match your git branch
SELECT dolt_checkout('fork');

-- Read current state
SELECT * FROM bugs WHERE status = 'open';
SELECT * FROM workarounds WHERE status = 'active';
SELECT * FROM custom_files;
SELECT * FROM sync_procedure ORDER BY step;
```

## Tables

| Table | Purpose |
|-------|---------|
| `bugs` | Open issues with this branch |
| `workarounds` | Active workarounds and when to remove them |
| `custom_files` | Files we changed vs upstream (path, type, purpose) |
| `sync_procedure` | Steps to sync with upstream |
| `config` | Branch-specific configuration |

## Dolt branches

The db has dolt branches matching git branches. Switch with `SELECT dolt_checkout('<branch>')` to see that branch's state.

## Updating

```sql
-- After making changes:
SELECT dolt_add('-A');
SELECT dolt_commit('-m', 'describe what changed');
```
