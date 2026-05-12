# Naming Conventions

This repo uses naming rules that match the current JavaScript ESM, CLI, config,
dashboard, and runtime compatibility surfaces. The goal is consistency for new
work without unsafe bulk renames of live identifiers.

## File naming

- Source modules in `src/`, `scripts/`, and `dashboard/public/` use lowercase
  kebab-case filenames such as `gateway-update-autopilot.mjs`.
- Test files in `test/` use `<subject>.test.mjs` with a kebab-case subject such
  as `gateway-update-autopilot.test.mjs`.
- CLI entrypoints keep the existing verb-first style so operators can predict
  command names: `report-*`, `run-*`, `check-*`, `plan-*`, `validate-*`,
  `watch-*`, `collect-*`, `build-*`, `deploy-*`, `manage-*`, `seed-*`,
  `set-*`, `sync-*`, `reconcile-*`, `ingest-*`, `status-*`, `mark-*`, and
  `probe-*`.
- Do not rename existing source files only to chase style if the current name
  is already part of a runtime, automation, import, or operator workflow.

## Identifier naming

- Functions, methods, locals, and ordinary exported helpers use `camelCase`.
- Classes use `PascalCase`.
- Immutable module-level constants use `SCREAMING_SNAKE_CASE`.
- Narrow test hooks or reset helpers may use a leading underscore when the name
  intentionally signals "not normal runtime API", for example `_resetBootstrap`.
- Exported compatibility objects that exist only for tests may use explicit
  sentinel names such as `__test__` or `__testing`.
- Existing mathematical/public compatibility helpers keep their established
  notation when a rename would be a breaking or cross-file churn risk. The
  current documented exception is `K_for_capital`.

## Runtime and compatibility exceptions

- Do not rename `strategyId`, `familyId`, `chainId`, `protocolId`, token
  symbols, env vars, CLI flags, audit event names, dashboard JSON keys,
  external API fields, or persisted JSON/JSONL schema fields just to match a
  generic naming rule. Those are compatibility surfaces first.
- Env vars stay `UPPER_SNAKE_CASE`.
- CLI flags stay `kebab-case`.
- Published JSON keys and append-only audit/data fields keep their existing
  casing unless there is a deliberate compatibility migration.
- When a new internal helper needs to interact with an external or persisted
  name, preserve the runtime field as-is and normalize it in adapter code
  instead of renaming the source of truth.

## Enforcement

- Run `npm run validate:naming` for the repository-wide check.
- Staged-file validation also runs through `scripts/pre-commit-staged-checks.mjs`
  so new files and new exports follow the documented rules before commit.
