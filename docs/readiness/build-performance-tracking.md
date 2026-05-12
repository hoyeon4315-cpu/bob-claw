# Build Performance Tracking

This repository now records real elapsed time for the agent-readiness validation
commands instead of relying on implicit CI timestamps, and it records the real
`node --test` suite duration for the repository test run.

## What is measured

- `npm ci`
- `npm run check:dead-code`
- `npm run check:tech-debt`
- `npm run check:duplicate-code`
- `npm run check:architecture`
- `npm run test`
- `npm run dashboard:build`

Each command is executed through `scripts/track-build-performance.mjs`, which:

- runs the real command unchanged
- measures wall-clock duration
- preserves the wrapped command's exit code
- writes one JSON record per invocation
- rewrites aggregate `summary.json` and `summary.md` files

`npm run perf:test` is stricter than the generic wrapper. It now runs through
`scripts/track-node-test-performance.mjs`, which:

- resolves the existing `package.json` `test` script instead of inventing a
  placeholder command
- adds the built-in `node --test --test-reporter tap` reporter only for the
  measured run, leaving `npm test` unchanged
- preserves the real test command's exit code
- parses the runner's own `duration_ms` output
- writes a dedicated test timing summary and raw TAP log artifact

## Output locations

Local and CI measurements are written under:

- `artifacts/build-performance/*.json`
- `artifacts/build-performance/summary.json`
- `artifacts/build-performance/summary.md`
- `artifacts/build-performance/test-performance-summary.json`
- `artifacts/build-performance/test-performance-summary.md`
- `artifacts/build-performance/test-performance.tap`

The directory is gitignored because it is a generated build artifact.

In GitHub Actions, `.github/workflows/auto-pr-validate.yml` also:

- enables `actions/setup-node@v4` npm dependency caching
- appends `artifacts/build-performance/summary.md` to the job step summary
- appends `artifacts/build-performance/test-performance-summary.md` to the job
  step summary
- uploads `artifacts/build-performance/` as the `build-performance-tracking` artifact

## Reproduction

Run the full readiness validation timing set locally:

```bash
npm run perf:agent-readiness
```

Run a single measured command:

```bash
node scripts/track-build-performance.mjs --label=dashboard-build --artifact-dir=artifacts/build-performance -- npm run dashboard:build
```

Useful narrower entry points:

- `npm run perf:test`
- `npm run perf:dashboard:build`
- `npm run perf:check:architecture`

Inspect the dedicated test timing outputs after a run:

```bash
cat artifacts/build-performance/test-performance-summary.md
cat artifacts/build-performance/test-performance-summary.json
```

## Notes

- This tracking does not modify runtime, signer, policy, caps, payback, or live execution logic.
- The test timing wrapper is CI-friendly: failures still emit the generic
  measurement record, the parsed test summary when available, and the original
  TAP log before the wrapper exits with the test command's nonzero status.
