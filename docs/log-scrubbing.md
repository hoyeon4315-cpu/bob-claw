# Log Scrubbing Guide

BOB Claw logs must preserve operational context without exposing key custody,
signing material, tokens, or raw transaction payloads. Use
`src/lib/log-scrubber.mjs` before sending objects or strings to future
structured loggers, error tracking, metrics, tracing, or ad hoc diagnostic
output.

## Usage

```js
import { safeJsonStringifyForLog, sanitizeLogRecord } from "../lib/log-scrubber.mjs";

const safeRecord = sanitizeLogRecord({
  event: "policy_result",
  strategyId: "example-strategy",
  chain: "base",
  policyVerdict: "approved",
  error,
});

console.error(safeJsonStringifyForLog(safeRecord));
```

The scrubber accepts strings, arrays, objects, `Error` instances, and circular
objects. It redacts values by sensitive key names and by common secret-like
patterns while preserving safe operational fields such as `strategyId`, `chain`,
`policyVerdict`, `txHash`, and `intentHash`.

## Never Log

- Private keys, WIF strings, seed phrases, signer key material, or wallet
  secrets.
- API keys, bearer tokens, webhook tokens, Telegram tokens, cookies, or
  authorization headers.
- Raw signed transactions, serialized transaction payloads, or long opaque hex
  blobs that are not public hashes.
- Local key file paths such as signer, wallet, burner, key, or keystore paths
  when they reveal custody location.
- Raw env secret values. Log whether a required secret-like setting is present,
  never the value.

## Audit Logs

Append-only audit logs keep their existing schema and semantics. Do not rewrite
or rotate `logs/signer-audit.jsonl`, `logs/kill-switch-audit.jsonl`,
`logs/dev-lock-audit.jsonl`, payback audit rows, receipt logs, or runtime
history as part of log scrubbing. When adding a new audit producer or diagnostic
logger, sanitize any non-public error/detail object before it is emitted, but do
not remove required public receipt identifiers such as transaction hashes.

## Verification

Run the focused check after changing redaction behavior:

```bash
npm run check:log-scrubbing
```

Tests use example-only fake sensitive values. Do not paste real secrets into
tests, snapshots, PR descriptions, logs, or failure messages.
