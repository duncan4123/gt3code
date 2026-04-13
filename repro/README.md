# DoltLite FTS5 Corruption Repro

Minimal repro package:

- `doltlite-fts5-corruption.c`
- `doltlite-fts5-corruption-noshell.sql`

What this proves:

- same SQL fixture
- same C program
- stock SQLite passes
- DoltLite-linked binary fails with:
  `fts5: corruption found reading blob 2199023255553 from table "chunks"`

Build latest DoltLite first:

```bash
mkdir -p build
cd build
../configure --all
make doltlite-lib
```

From this `repro/` directory, build stock SQLite version:

```bash
gcc -O2 -o c-stock doltlite-fts5-corruption.c -lsqlite3 -lm
```

Build DoltLite-linked version:

```bash
gcc -O2 -o c-doltlite doltlite-fts5-corruption.c \
  -I/path/to/doltlite/build \
  /path/to/doltlite/build/libdoltlite.a \
  -lpthread -lz -lm
```

Run same fixture through both:

```bash
./c-stock /tmp/c-stock.db doltlite-fts5-corruption-noshell.sql
./c-doltlite /tmp/c-doltlite.db doltlite-fts5-corruption-noshell.sql
```

Expected:

- stock SQLite: `PASS`
- DoltLite: fails with FTS5 corruption in `chunks`

Notes:

- no MCP
- no app runtime
- no JS or Python required
- repro is plain SQL plus SQLite C API only
