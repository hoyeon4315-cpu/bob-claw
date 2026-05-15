# Dead Feature Flag Detection

This repository runs dedicated tooling to detect dead (defined but unused) feature flags
and stale references (code calling `isFeatureEnabled`/`getFeatureFlagDefinition` with
IDs not present in the committed manifest). This directly addresses the Agent Readiness
"Dead Feature Flag Detection" signal.

## Enforcement

- `npm run check:dead-feature-flags` (and `perf:check:dead-feature-flags`) executes
  `scripts/check-dead-feature-flags.mjs`.
- The check:
  - Loads the canonical `FEATURE_FLAGS` manifest from `src/config/feature-flags.mjs`.
  - Scans `src/`, `test/`, `scripts/`, `dashboard/public/`, `docs/`, and `.github/` for
    calls to `isFeatureEnabled("...")` and `getFeatureFlagDefinition("...")`.
  - Also detects bare string mentions of defined flag IDs (for docs and test coverage).
  - Fails on:
    - **Dead flags**: IDs present in the manifest but with zero references outside the
      definition file itself.
    - **Stale references** (outside `test/`): code references flag IDs that are not in
      the manifest (negative-test cases inside `test/feature-flags.test.mjs` are allowed).
- The check is part of `perf:agent-readiness` and runs in `auto-pr-validate.yml` on
  relevant paths (package.json, scripts/**, test/**, src/config/**, docs/readiness/**).

## Adding or Removing a Flag (Lifecycle)

1. To add a flag: add it to `FEATURE_FLAGS` in `src/config/feature-flags.mjs` **with**
   a real consumer (`isFeatureEnabled` call in a report/dashboard/scaffold module),
   a focused test, and run `npm run check:feature-flags && npm run check:dead-feature-flags`.
2. To remove a flag: delete the entry, remove all call sites and mentions, then verify
   both feature-flag checks and the full test suite pass.
3. Never leave a flag defined without a consumer — the dead-flag detector will fail the
   PR and block auto-merge.

## Design Notes

- Feature flags are **committed-only, non-overrideable** (see `src/config/feature-flags.mjs`
  and `docs/readiness/feature-flags.md`). Dead detection is therefore a static source
  hygiene check, not a runtime platform feature.
- The detector is intentionally lightweight (regex on call sites + bare mentions) and
  does not require external feature flag services.
- Because the manifest is tiny and strictly gated by `ALLOWED_FEATURE_FLAG_SCOPES` and
  `FORBIDDEN_FEATURE_FLAG_AUTHORITY`, the expected steady state is zero dead flags.

## Related Commands

- `npm run check:dead-feature-flags`
- `npm run perf:check:dead-feature-flags`
- `npm run profile:check:dead-feature-flags`
- `npm run check:feature-flags` (manifest validation + basic consumer test)
- Part of `npm run perf:agent-readiness`

See also: `docs/readiness/feature-flags.md` for the infrastructure rules.
