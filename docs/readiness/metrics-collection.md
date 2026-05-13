# Metrics Collection

BOB Claw exposes dependency-free local engineering metrics through
`src/metrics/registry.mjs` and the read-only smoke CLI:

```bash
node src/cli/report-metrics-snapshot.mjs
node src/cli/report-metrics-snapshot.mjs --json
npm run report:metrics-snapshot -- --json
```

The default output is Prometheus/OpenMetrics-style text. `--json` emits a
structured snapshot for agents and tests. This is intentionally local and
secret-free; no Datadog, New Relic, CloudWatch, Axiom, Prometheus server, or
vendor key is required.

## Safe Scope

Metrics are observability only. They must not feed caps, `autoExecute`, policy
approval, signer approval, kill-switch status, payback decisions, readiness
blockers, or any live execution authority path.

Use metrics for engineering facts such as:

- report/check command run counts
- report/check durations
- exporter health/info gauges
- bounded status categories such as `result=ok` or `result=blocked`

## Forbidden Labels

Metric labels must stay low-cardinality and public-safe. Do not use:

- private keys, API keys, Telegram tokens, env secret values, or key paths
- wallet addresses except already-public identifiers in non-label fields
- tx hashes, intent hashes, Gateway order ids, full route ids, raw signed
  payloads, raw error messages, or private filesystem paths
- arbitrary user input or unbounded strings

The registry validates metric names and labels and rejects secret-like,
hash-like, path-like, address-like, and high-cardinality label values.

## Audit Log Relationship

Metrics are not append-only evidence. They do not replace
`logs/signer-audit.jsonl`, kill-switch audit logs, payback audit evidence, or
receipt logs, and they must not change those schemas. Audit logs remain the
source of execution proof; metrics are only a lightweight engineering telemetry
surface for monitoring app-code behavior.
