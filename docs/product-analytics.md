# Product Analytics Instrumentation

BOB Claw product analytics is feature-usage observability only. It helps show
which dashboard views and interactions are used, and it must never influence
caps, policy approval, signer approval, kill-switch state, payback decisions,
readiness blockers, or live execution behavior.

## Provider

The dashboard and source helper use a PostHog-compatible adapter. Production
delivery is disabled by default and only sends when explicitly configured.

Environment variable names for deployment setup:

- `BOB_CLAW_ANALYTICS_ENABLED=true`
- `BOB_CLAW_POSTHOG_API_HOST`
- `BOB_CLAW_POSTHOG_PROJECT_KEY`

Do not commit vendor keys, tokens, or environment values. In local validation
and PR checks, analytics stays in dry-run/no-op mode and does not send external
events.

## Allowed Events

- `dashboard_view`
- `dashboard_tab_changed`
- `dashboard_interaction`
- `dev_report_viewed`

Allowed properties are intentionally low-cardinality:

- `surface`
- `view`
- `interaction`
- `component`
- `entryPoint`
- `releaseChannel`
- `statusCategory`

## Forbidden Data

Analytics events, properties, and user context must not include private keys,
env secret values, wallet/signing data, Telegram tokens, API keys, seed
phrases, signer key material, raw signed transaction payloads, raw key paths,
wallet addresses, operator identity, intent hashes, transaction hashes, raw
error messages, raw file paths, or raw command output.

High-cardinality identifiers such as route ids, addresses, transaction hashes,
intent hashes, raw file paths, and raw command output are rejected by the
analytics guard instead of being redacted after the fact.

## Audit Log Boundary

Product analytics is not an audit log. Existing append-only audit logs
(`logs/signer-audit.jsonl`, kill-switch audit, payback audit, receipt logs) keep
their schema and semantics. Analytics records only privacy-safe usage events and
must not be used as execution evidence, settlement proof, or readiness authority.
