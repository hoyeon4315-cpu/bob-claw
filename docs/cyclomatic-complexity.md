# Cyclomatic Complexity

This repository now tracks cyclomatic complexity with the ESLint core
`complexity` rule instead of relying on an external placeholder check.

## Threshold and enforcement

- The enforced threshold is `20`.
- `npm run report:complexity` scans tracked repo source and prints the current
  baseline offenders.
- `npm run validate:complexity` validates files changed since `origin/main`.
- `scripts/pre-commit-staged-checks.mjs` also runs the validator against staged
  source files, so new or edited code cannot silently raise complexity past the
  enforced limit.

## Changed-file gate

The current repository already contains many long-lived live-critical modules
whose cyclomatic complexity is above `20`. Refactoring those modules just to
clear an Agent Readiness signal would create unnecessary live-path risk. For
that reason, the initial enforcement strategy is:

- repo-wide baseline reporting for visibility
- changed-file/staged-file enforcement for new work

This keeps the check substantive today without forcing broad runtime refactors.

## Scope

The complexity check targets tracked source files in:

- `src/**/*.mjs`
- `scripts/**/*.mjs`
- `test/**/*.mjs`
- `*.config.mjs`

## Excluded surfaces

The complexity tooling excludes generated or operational surfaces that should
not drive this readiness signal:

- `data/**`
- `logs/**`
- `build/**`, `dist/**`, `out/**`
- `.cloudflare/**`, `.playwright-cli/**`, `.wrangler/**`, `node_modules/**`
- `dashboard/public/*.json`
- generated `dashboard/public/*.js`
