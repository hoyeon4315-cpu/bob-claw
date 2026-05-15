# Product Analytics Instrumentation

BOB Claw includes a privacy-first product analytics instrumentation layer using a PostHog-compatible adapter. It allows measuring real feature usage (dashboard views, interactions, dev report views) so that autonomous agents can evaluate the impact of changes on user behavior.

## Configuration

Production delivery is **disabled by default** (dry-run mode). Events are only sent when explicitly configured via environment variables:

- `BOB_CLAW_ANALYTICS_ENABLED=true`
- `BOB_CLAW_POSTHOG_PROJECT_KEY`
- `BOB_CLAW_POSTHOG_API_HOST` (optional, defaults to https://app.posthog.com)

In all local development, CI, and PR validation runs, analytics remains in dry-run / no-op mode. No data leaves the process unless the three variables above are present and valid.

## Allowed Surface

Only a small, curated set of low-cardinality events and properties are permitted:

**Events**
- `dashboard_view`
- `dashboard_tab_changed`
- `dashboard_interaction`
- `dev_report_viewed`

**Properties** (max 8 per event)
- `surface`, `view`, `interaction`, `component`, `entryPoint`, `releaseChannel`, `statusCategory`

All other property names and any sensitive or high-cardinality values (private keys, wallet data, tx hashes, file paths, raw errors, etc.) are **hard-blocked** at the tracker level before any delivery attempt.

## Implementation

- Server-side tracker: `src/analytics/product-analytics.mjs`
- Dashboard client: `dashboard/public/analytics.jsx` (built into `analytics.js` during dashboard publish)
- Smoke / validation: `src/cli/check-product-analytics.mjs`
- Full test suite: `test/product-analytics.test.mjs`
- Documentation: `docs/product-analytics.md`

The tracker is exercised as part of `perf:agent-readiness` via `perf:check:product-analytics` and `profile:check:product-analytics`.

## Safety & Scope

- Never used for policy, caps, signer, kill-switch, payback, or any live execution decision.
- All events carry only approved, sanitized, low-cardinality data.
- Sensitive value detection runs on both keys and values (regex for 0x..., bc1..., key/secret patterns, long strings, newlines, etc.).
- In dry-run mode the events are recorded locally for inspection but never transmitted.

This instrumentation gives agents visibility into which parts of the dashboard and reporting surface are actively used, without compromising the strict security and privacy boundaries of the BOB Claw operator environment.
