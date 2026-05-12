# Duplicate Code Detection

This repository now tracks copy-paste duplication with `jscpd` against tracked
source files instead of relying on an absent or placeholder readiness signal.

## Enforcement model

- `npm run report:duplicate-code` runs `jscpd` and writes the raw JSON report to
  `.jscpd-report/jscpd-report.json`.
- `npm run check:duplicate-code` reruns the detector and compares the current
  duplicate fingerprint set against
  `docs/readiness/duplicate-code-baseline.json`.
- New duplicate fingerprints and duplicate-count regressions fail the check.
- Resolved or reduced duplicates are reported but do not fail the check.

The repository already contains a substantial amount of historical duplication
across CLI, strategy, and test surfaces. Broad live-path DRY refactors would be
riskier than the readiness signal itself, so the initial enforcement model is:

- repo-wide detection on real tracked source files
- committed audited baseline for existing duplication
- fail-fast on new duplication introduced after this fix

## Detection threshold

- `minLines: 12`
- `minTokens: 100`
- `mode: mild`

These settings are intentionally stricter than a decorative presence check but
high enough to focus on meaningful copy-paste blocks instead of tiny repeated
syntax.

## Scope

The detector scans these committed source surfaces:

- `src/**/*.mjs`
- `scripts/**/*.mjs`
- `test/**/*.mjs`
- `dashboard/public/**/*.jsx`
- `eslint.config.mjs`
- `knip.config.js`

## Excluded surfaces

Generated, runtime, cached, and deploy-artifact paths stay out of duplicate
enforcement:

- `data/**`
- `logs/**`
- `coverage/**`
- `dist/**`, `out/**`
- `.cloudflare/**`, `.playwright-cli/**`, `.wrangler/**`
- `node_modules/**`
- generated `dashboard/public/*.js`
- generated/runtime `dashboard/public/*.json`
- `graphify-out/**`, `src/graphify-out/**`

The raw `.jscpd-report/` directory is a local output path and should not be
committed.
