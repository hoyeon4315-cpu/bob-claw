function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function evaluateStaleQuote({
  intent = {},
  maxAgeMs = intent.quote?.maxAgeMs ?? intent.strategyConfig?.intentTtlMs ?? 30_000,
  now = new Date().toISOString(),
} = {}) {
  const quoteObservedAt = intent.quote?.observedAt || intent.observedAt || null;
  const blockers = [];
  const quoteAgeMs = quoteObservedAt ? new Date(now).getTime() - new Date(quoteObservedAt).getTime() : null;

  if (!quoteObservedAt) {
    blockers.push("quote_timestamp_missing");
  } else if (!isFiniteNumber(quoteAgeMs) || quoteAgeMs < 0) {
    blockers.push("quote_timestamp_invalid");
  } else if (quoteAgeMs > maxAgeMs) {
    blockers.push("quote_stale");
  }

  return {
    policy: "stale_quote",
    observedAt: now,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers,
    metrics: {
      quoteObservedAt,
      quoteAgeMs,
      maxAgeMs,
    },
  };
}
