// Deterministic tiny-live-canary intent builder.
// Pure function. No I/O, no LLM.

export function buildTinyLiveCanaryIntent({
  strategyId,
  chain,
  family = "evm",
  amountUsd = 0,
  microCanaryStatus = null,
  metadata = {},
  now = new Date().toISOString(),
} = {}) {
  if (!strategyId) throw new Error("strategyId is required");
  if (!chain) throw new Error("chain is required");
  return {
    schemaVersion: 1,
    intentId: `${strategyId}:tiny-live-canary:${now}`,
    strategyId,
    chain,
    family,
    mode: "tiny_live",
    intentType: "tiny_live_canary",
    amountUsd: Number.isFinite(amountUsd) ? amountUsd : 0,
    executionReason: "tiny_live_canary_execution",
    observedAt: now,
    metadata: {
      ...metadata,
      microCanaryStatus: microCanaryStatus || null,
    },
  };
}
