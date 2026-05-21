# Trace Context

`src/trace-context.mjs` provides the repository's lightweight request tracing
context. It is intentionally non-signing and only carries observability fields:
`traceId`, `parentTraceId`, `requestId`, `spanId`, `parentSpanId`, `boundary`,
`name`, `component`, `operation`, `startedAt`, and `sampled`.

## Propagation

- Inbound HTTP or job runners can seed context from `traceparent`,
  `X-Request-ID`, `X-Trace-ID`, `X-Span-ID`, and `X-Parent-Span-ID`.
- Child work should call `childTraceContext(parent, { boundary, name })` so
  follow-on logs keep the same `traceId` and `requestId` while recording parent
  span linkage.
- `createLogger({ traceContext })` includes sanitized trace metadata on every
  structured log line, making a request searchable across non-live checks and
  observability output.
- `src/cli/status-dashboard.mjs` is the current safe propagation boundary:
  explicit `--request-id`, `--trace-id`, or `--traceparent` input flows into
  the dashboard build span and lands in `dashboard-status.json` under
  `observability.trace`, plus matching stdout identifiers for operators.

## Safe Smoke Check

Run this non-live check to verify trace creation, child propagation, header
export, and structured-log attachment:

```bash
npm run check:trace-context -- --request-id=local-smoke
```

The command writes one JSONL record to stdout. It does not touch signer,
receipt, payback, or audit logs.
