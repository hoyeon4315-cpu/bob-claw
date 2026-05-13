# Trace Context

`src/trace-context.mjs` provides the repository's lightweight request tracing
context. It is intentionally non-signing and only carries observability fields:
`traceId`, `requestId`, `spanId`, `parentSpanId`, `boundary`, `name`, and
`sampled`.

## Propagation

- Inbound HTTP or job runners can seed context from `X-Request-ID`,
  `X-Trace-ID`, `X-Span-ID`, and `X-Parent-Span-ID`.
- Child work should call `childTraceContext(parent, { boundary, name })` so
  follow-on logs keep the same `traceId` and `requestId` while recording parent
  span linkage.
- `createLogger({ traceContext })` includes sanitized trace metadata on every
  structured log line, making a request searchable across non-live checks and
  observability output.

## Safe Smoke Check

Run this non-live check to verify trace creation, child propagation, header
export, and structured-log attachment:

```bash
npm run check:trace-context -- --request-id=local-smoke
```

The command writes one JSONL record to stdout. It does not touch signer,
receipt, payback, or audit logs.
