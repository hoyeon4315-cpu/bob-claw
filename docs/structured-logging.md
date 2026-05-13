# Structured Logging

`src/logger.mjs` is the app-code structured logger for BOB Claw observability.
It is not an audit-log writer and must not replace signer, kill-switch,
payback, receipt, or capital-audit records.

## Behavior

- Emits one JSON object per line with `schemaVersion`, `timestamp`, `level`,
  `component`, `event`, and sanitized structured fields.
- Routes `debug` and `info` to stdout; routes `warn` and `error` to stderr.
- Optionally appends the same JSON line to an explicit observability file.
- Refuses file targets that look like audit or receipt logs, including
  `logs/*audit*.jsonl`, `logs/*receipt*.jsonl`, and receipt/capital-audit JSONL
  under `data/`.

## Redaction Rules

The logger redacts sensitive fields by default when keys look like private key,
secret, token, API key, password, mnemonic, authorization, signature, raw signed
transaction, calldata, or key-path material.

Do not pass these values to logger calls:

- private keys, mnemonics, seed phrases, or signing secrets
- env secret values, API keys, Telegram tokens, or authorization headers
- raw signed transactions, signatures, calldata, or signer payloads
- key file paths such as `BURNER_EVM_KEY_PATH` or `BURNER_BTC_KEY_PATH` values

The redactor is a backstop, not permission to log sensitive material.

## Safe Smoke Check

Use this non-live check to verify the logger path:

```bash
node src/cli/check-structured-logger.mjs
```

Optional append-only observability file output:

```bash
node src/cli/check-structured-logger.mjs --file=/tmp/bob-claw-observability.jsonl
```

Do not point `--file` at runtime audit, signer audit, payback audit, receipt, or
capital-audit files.
