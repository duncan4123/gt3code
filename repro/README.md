# DoltLite FTS5 Corruption Repro

Files:

- `doltlite-fts5-corruption.c`: C repro using SQLite API directly.
- `doltlite-fts5-corruption.py`: Python repro using standard `sqlite3`.
- `doltlite-fts5-corruption.mjs`: helper that generates SQL fixture and compares shells.
- `doltlite-fts5-corruption.sql`: generated SQL fixture for shell repro.
- `doltlite-fts5-corruption-noshell.sql`: same fixture without sqlite shell meta-commands.

Recommended upstream proof:

1. Build latest DoltLite with FTS5 enabled:
   `mkdir -p build && cd build && ../configure --all && make doltlite-lib doltlite`
2. Build stock SQLite C repro against real system SQLite:
   `gcc -O2 -o c-stock-system doltlite-fts5-corruption.c /lib/x86_64-linux-gnu/libsqlite3.so.0 -lm`
3. Build DoltLite C repro against `libdoltlite.a`:
   `gcc -O2 -o c-doltlite doltlite-fts5-corruption.c -I/path/to/doltlite/build /path/to/doltlite/build/libdoltlite.a -lpthread -lz -lm`
4. Run same SQL fixture through both:
   `./c-stock-system /tmp/c-stock.db doltlite-fts5-corruption-noshell.sql`
   `./c-doltlite /tmp/c-doltlite.db doltlite-fts5-corruption-noshell.sql`

Expected result:

- stock SQLite: `PASS`
- DoltLite: `fts5: corruption found reading blob 2199023255553 from table "chunks"`

Notes:

- This repro uses plain SQL and SQLite C API only.
- It does not depend on MCP tools or `ContentStore.index()`.
- The Python `LD_PRELOAD=libdoltlite.so` path passed locally; the direct C-link path reproduced the bug.
