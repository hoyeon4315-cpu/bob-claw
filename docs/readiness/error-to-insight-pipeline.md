# Error To Insight Pipeline

This readiness path converts a repo-local sanitized error report into an
actionable GitHub issue payload. It is a dev/report automation surface only: it
does not call the signer, policy engine, payback scheduler, capital mover,
deployment tooling, or any live broadcast command.

## Commands

Dry-run preview, using the committed sanitized fixture:

```bash
npm run error-to-issue:dry-run
```

Targeted check:

```bash
npm run check:error-to-issue
```

Manual local dry-run with a sanitized JSON report:

```bash
node src/cli/error-to-issue.mjs --input /path/to/sanitized-error-report.json --dry-run=true --repo=owner/repo
```

Real issue creation is disabled by default. To create an issue, the operator
must explicitly pass `--dry-run=false --create` and provide a GitHub token via
`GITHUB_TOKEN` or `ERROR_TO_ISSUE_GITHUB_TOKEN`.

## GitHub Workflow

`.github/workflows/error-to-insight.yml` runs tests and a fixture dry-run on pull
requests. Manual `workflow_dispatch` accepts `error_report_json`, `dry_run`, and
`create_issue` inputs.

Defaults:

- `dry_run=true`
- `create_issue=false`

Real GitHub issue creation happens only when both are true:

- `dry_run=false`
- `create_issue=true`

The workflow uses the built-in `GITHUB_TOKEN` for manual issue creation. No
secret values should be committed or pasted into workflow inputs.

## Sanitization Contract

The payload builder redacts:

- private keys and key-looking 32-byte hex values
- API/GitHub/Telegram-style tokens
- wallet addresses
- raw tx hashes and raw intent hashes
- raw key paths and user home path identity
- sensitive context fields such as `privateKey`, `BURNER_EVM_KEY_PATH`,
  `walletAddress`, `txHash`, `intentHash`, `signedTx`, and `seedPhrase`

Issue bodies include summary, affected component, sanitized stack/context,
reproduction/evidence, safety impact, next checks, and a secret-safety warning.

## Duplicate Strategy

Each payload includes a deterministic `error-fingerprint: <hash>` marker derived
from sanitized component, error class, message, and top stack line. Real creation
first searches open GitHub issues with:

```text
repo:<owner>/<repo> is:issue is:open <fingerprint> in:body
```

If a matching open issue is found, the CLI reports `duplicate_found` and does
not create another issue.

## Labels

Default desired labels are:

- `type/bug`
- `area/runtime`
- `readiness/blocker`

During real creation, the CLI checks the repository labels first and applies
only labels that already exist. Missing labels are reported in the CLI result so
the operator can add taxonomy labels separately without causing the issue
creation request to fail.
