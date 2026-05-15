# Error Tracking

BOB Claw uses `src/observability/error-tracking.mjs` for contextual error
tracking. The adapter is observability-only: it must not feed caps,
`autoExecute`, policy approval, signer approval, kill-switch status, payback
decisions, readiness blockers, or live execution authority.

## Runtime Mode

Sentry is configured only when both of these are true:

- `BOB_CLAW_ERROR_TRACKING_ENABLED=1`
- `BOB_CLAW_SENTRY_DSN` is present

If either value is missing, the tracker is a safe no-op and does not import the
Sentry SDK or send events. PR validation must use this no-op/dry-run mode.

Optional context variables:

- `BOB_CLAW_ERROR_TRACKING_ENVIRONMENT`
- `SENTRY_RELEASE`

Do not commit DSN values, auth tokens, org/project credentials, or source-map
upload tokens.

## Safe Context

Allowed context is anonymous and operational, such as component name,
environment, release, command family, or bounded status values like `blocked`
or `ok`.

## Sentry GitHub Integration (Error to Insight)

To automatically turn Sentry errors into GitHub issues (the "error to insight" pipeline):

1. Install the official Sentry GitHub App on this repository (gives Sentry permission to create issues).
2. In the Sentry project settings → Integrations → GitHub, connect the repository.
3. Set the following environment variables in the deployment environment:
   - `BOB_CLAW_SENTRY_ORG` (or `SENTRY_ORG`)
   - `BOB_CLAW_SENTRY_PROJECT` (or `SENTRY_PROJECT`)
4. The custom `error-to-issue` pipeline (`src/observability/error-to-issue.mjs` and `src/cli/error-to-issue.mjs`) will include a direct link to the corresponding Sentry issue in every created GitHub issue.

When configured, Sentry will automatically create GitHub issues for new error groups (with the repo linked in the integration). The custom sanitizer ensures no secrets or high-risk data ever reaches the GitHub issue body.

The `error-to-insight.yml` workflow supports both the native Sentry integration and manual sanitized report creation for high-severity or custom cases.

Never attach these to events, breadcrumbs, tags, context, source map uploads,
logs, or user context:

- private keys, seed phrases, mnemonic material, env secret values, API keys,
  Telegram tokens, DSN auth tokens, or key paths
- wallet addresses, operator identity, account identifiers, txids, intent
  hashes, Gateway order ids, raw signed transactions, or raw payloads
- raw audit-log rows or append-only execution evidence

The sanitization helper redacts sensitive keys and values before event capture.
Do not bypass it with direct Sentry SDK calls.

## Source Maps

Dashboard source maps are opt-in for error tracking release preparation:

```bash
npm run check:error-tracking
```

The check builds dashboard JSX into a temporary directory with external source
maps and prints a dry-run result. It does not upload source maps, create a
Sentry release, or write generated dashboard assets to the repo.

Actual upload, if the operator enables it outside PR validation, must use
operator-provided Sentry credentials from the environment and keep uploads
limited to generated dashboard JavaScript/source-map pairs for the matching
`SENTRY_RELEASE`.

## Audit Log Relationship

Error tracking is not append-only execution proof. It does not replace or
change `logs/signer-audit.jsonl`, kill-switch audit logs, payback audit
evidence, receipt logs, or dashboard public truth slices.
