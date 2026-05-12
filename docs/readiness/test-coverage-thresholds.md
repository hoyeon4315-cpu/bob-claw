# Test Coverage Thresholds

## Scoped source coverage gate

BOB Claw uses a real fail-under coverage gate in `npm run test:coverage`.
The gate runs the existing Node test runner with built-in V8 coverage thresholds
and fails with a nonzero exit code when the scoped source coverage drops below
the configured minimums.

Current enforced source scope:

- `src/executor/policy/*.mjs`
- `src/executor/payback/*.mjs`
- `src/risk/auto-kill-triggers.mjs`

These files were chosen because they already have substantive test suites and
they are central to autonomous agent safety and execution truth. The gate does
not skip or weaken tests; it measures the existing policy, payback, and
auto-kill suites directly.

## Thresholds

The current minimums are enforced in both local script execution and pull
request validation:

- Lines: `80`
- Branches: `65`
- Functions: `80`

These values are set from the current measured baseline of the scoped source
set and remain high enough to catch regressions without inventing fake repo-wide
coverage for unscoped files. Pull requests run the gate in a dedicated
`coverage_thresholds` workflow job on Node 26 so the scoped built-in
`--test-coverage-*` fail-under flags are available without changing the
repo-wide Node 20 validation job.

## Excluded surfaces and follow-up

This gate is intentionally scoped instead of pretending the whole repository is
already coverage-ready. It does not currently enforce coverage on generated or
operational artifacts, including:

- `dashboard/public/*.json`
- `data/**`
- `logs/**`
- build artifacts, coverage output, dependency, and cache directories

It also does not yet enforce a repo-wide threshold across every CLI and
strategy file, because many of those surfaces still need focused test
consolidation before a single global threshold would be honest. The follow-up
path is to add similarly real, test-backed coverage scopes for other mature
areas instead of lowering this gate or adding decorative 0% thresholds.
