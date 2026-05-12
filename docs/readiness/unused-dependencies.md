# Unused Dependencies Detection

This repository now runs a real unused-dependency detector instead of relying
on agent-readiness inference from missing tooling.

## Enforcement model

- `npm run check:unused-dependencies` runs `knip` against committed source,
  script, research, dashboard-source, and test entrypoints.
- The check fails on:
  - unused `dependencies`
  - unused `devDependencies`
  - unlisted imports from in-scope entrypoints
- The check does not remove packages automatically. Any future dependency
  removal still requires proving the runtime or script call path first.

## Scope

The detector starts from real repo entrypoints:

- `package.json` scripts
- CLI/script/research paths referenced from `src/`, `test/`, `scripts/`, or
  `.github/workflows/`
- `test/**/*.test.mjs`

It analyzes these committed source surfaces:

- `src/**/*.{mjs,cjs,js}`
- `scripts/**/*.{mjs,cjs,js}`
- `research/**/*.{mjs,cjs,js}`
- `dashboard/public/**/*.jsx`
- `test/**/*.test.mjs`

## Excluded surfaces

Generated, runtime, cache, or local-ops paths are intentionally out of scope:

- `data/**`
- `logs/**`
- `state/**`
- `artifacts/**`
- `coverage/**`
- `dist/**`, `out/**`
- `.cloudflare/**`, `.playwright-cli/**`, `.wrangler/**`
- `node_modules/**`
- generated `dashboard/public/*.js`
- generated/runtime `dashboard/public/*.json`
- `graphify-out/**`, `src/graphify-out/**`

## Documented ignores

The detector ignores three tracked root scripts:

- `deploy-verify.cjs`
- `test-local.cjs`
- `test-local2.cjs`

Reason: they are local Playwright scratch helpers for ad hoc dashboard/manual
verification, not repo-supported source or package-script entrypoints. Keeping
them out of `knip` avoids forcing a heavyweight `playwright` dependency into
the production repository just to satisfy local one-off browser checks.

The detector also documents one dependency-level exception:

- `jscpd`

Reason: `scripts/check-duplicate-code.mjs` executes `jscpd` through its
committed package binary path (`node_modules/jscpd/bin/jscpd`) instead of
importing it as a module. Knip cannot infer that binary-only usage from ESM
imports, but the duplicate-code readiness gate depends on the package.
