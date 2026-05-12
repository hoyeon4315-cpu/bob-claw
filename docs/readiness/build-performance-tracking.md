# Build Performance Tracking

This repository now records real elapsed time for the agent-readiness validation
commands instead of relying on implicit CI timestamps.

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

## Output locations

Local and CI measurements are written under:

- `artifacts/build-performance/*.json`
- `artifacts/build-performance/summary.json`
- `artifacts/build-performance/summary.md`

The directory is gitignored because it is a generated build artifact.

In GitHub Actions, `.github/workflows/auto-pr-validate.yml` also:

- enables `actions/setup-node@v4` npm dependency caching
- appends `artifacts/build-performance/summary.md` to the job step summary
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

## Notes

- This tracking does not modify runtime, signer, policy, caps, payback, or live execution logic.
- The timing wrapper is CI-friendly: failures still emit a measurement record before the wrapper exits with the original nonzero status.
