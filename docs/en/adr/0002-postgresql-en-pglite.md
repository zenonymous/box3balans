# PostgreSQL, with PGlite as the built-in variant

_Nederlands: [0002-postgresql-en-pglite.md](../../adr/0002-postgresql-en-pglite.md)_

Amounts and quantities must be exact (`NUMERIC`), and anyone with a NAS can easily run a second container. The normal installation therefore uses PostgreSQL in Docker Compose. For trying it out, on a laptop, during development and in the tests, the same database runs as PGlite inside the process itself, with the same migrations. That way there's one schema and one set of queries, and tests and developers don't need Docker. So the code doesn't use what PGlite can't do.
