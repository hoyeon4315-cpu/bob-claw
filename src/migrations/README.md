# Schema Migrations

Each file `v{N}.mjs` exports a default pure function `(dbState) => newDbState`.
Migrations are executed in order by `src/executor/health/schema-migrations.mjs`.

