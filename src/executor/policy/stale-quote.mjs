function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export const CHAIN_AWARE_QUOTE_TTLS_MS = Object.freeze({
  ethereum: 90_000,
  bitcoin: 120_000,
  base: 30_000,
  bob: 30_000,
  avalanche: 30_000,
  bera: 30_000,
  bsc: 30_000,
  optimism: 30_000,
  sei: 30_000,
  soneium: 30_000,
  sonic: 30_000,
  unichain: 30_000,
});

function chainAwareTtlMs(chain) {
  return CHAIN_AWARE_QUOTE_TTLS_MS[chain] ?? null;
}

export function resolveQuoteMaxAgeMs({ intent = {}, maxAgeMs = null } = {}) {
  const configuredMaxAgeMs = intent.quote?.maxAgeMs ?? intent.strategyConfig?.intentTtlMs ?? maxAgeMs ?? 30_000;
  const chainDefaultMs = chainAwareTtlMs(intent.chain);
  if (!isFiniteNumber(chainDefaultMs)) return configuredMaxAgeMs;
  if (!isFiniteNumber(configuredMaxAgeMs)) return chainDefaultMs;
  return Math.max(configuredMaxAgeMs, chainDefaultMs);
}

export function evaluateStaleQuote({
  intent = {},
  maxAgeMs = null,
  now = new Date().toISOString(),
} = {}) {
  const resolvedMaxAgeMs = resolveQuoteMaxAgeMs({ intent, maxAgeMs });
  const quoteObservedAt = intent.quote?.observedAt || intent.observedAt || null;
  const blockers = [];
  const quoteAgeMs = quoteObservedAt ? new Date(now).getTime() - new Date(quoteObservedAt).getTime() : null;

  if (!quoteObservedAt) {
    blockers.push("quote_timestamp_missing");
  } else if (!isFiniteNumber(quoteAgeMs) || quoteAgeMs < 0) {
    blockers.push("quote_timestamp_invalid");
  } else if (quoteAgeMs > resolvedMaxAgeMs) {
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
      maxAgeMs: resolvedMaxAgeMs,
      configuredMaxAgeMs: intent.quote?.maxAgeMs ?? intent.strategyConfig?.intentTtlMs ?? maxAgeMs ?? 30_000,
      chainAwareDefaultMs: chainAwareTtlMs(intent.chain),
    },
  };
}
