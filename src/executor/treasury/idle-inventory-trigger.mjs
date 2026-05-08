const DEFAULT_GATEWAY_DESTINATIONS = Object.freeze([
  "ethereum",
  "bob",
  "base",
  "bsc",
  "avalanche",
  "unichain",
  "bera",
  "optimism",
  "soneium",
  "sei",
  "sonic",
]);

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function itemAgeMs(item = {}, snapshot = {}, nowMs) {
  const timestamp =
    item.idleSince ||
    item.firstSeenAt ||
    item.observedAt ||
    item.updatedAt ||
    item.generatedAt ||
    snapshot.idleSince ||
    null;
  if (!timestamp) return Infinity;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : Infinity;
}

function isBtcFamilyIdleToken(item = {}) {
  if (item.family !== "token") return false;
  if (item.protocolId || item.positionId || item.bindingKind) return false;
  const sym = String(item.sym || item.symbol || "").toLowerCase();
  const name = String(item.name || "").toLowerCase();
  if (sym === "cbbtc" || name.includes("cbbtc")) return false;
  return sym === "wbtc" || name.includes("wbtc.oft") || name === "wbtc";
}

export function buildIdleInventoryConsolidationPlan({
  walletSnapshot = {},
  gatewayDestinations = DEFAULT_GATEWAY_DESTINATIONS,
  threshold = {},
  now = new Date().toISOString(),
} = {}) {
  const destinationSet = new Set([...gatewayDestinations].map((chain) => String(chain).toLowerCase()));
  const dstChain = String(threshold.dstChain || "base").toLowerCase();
  const minIdleUsd = finite(threshold.minIdleUsd) ?? 5;
  const minIdleAgeMs = finite(threshold.minIdleAgeMs) ?? 72 * 60 * 60 * 1000;
  const maxAggregateIdleUsd = finite(threshold.maxAggregateIdleUsd) ?? 50;
  const nowMs = new Date(now).getTime();
  const candidates = [];
  let aggregateUsd = 0;

  const sourceItems = Array.isArray(walletSnapshot.items) ? walletSnapshot.items : [];
  for (const item of sourceItems) {
    const srcChain = String(item.chain || "").toLowerCase();
    const usd = finite(item.usd);
    const amount = finite(item.amount);
    if (!destinationSet.has(srcChain) || srcChain === dstChain) continue;
    if (!isBtcFamilyIdleToken(item)) continue;
    if (!(usd >= minIdleUsd) || !(amount > 0)) continue;
    if (itemAgeMs(item, walletSnapshot, nowMs) < minIdleAgeMs) continue;
    const remainingUsd = maxAggregateIdleUsd - aggregateUsd;
    if (!(remainingUsd > 0)) break;
    const takeUsd = Math.min(usd, remainingUsd);
    const takeFraction = takeUsd / usd;
    const sats = Math.floor(amount * takeFraction * 100_000_000);
    if (sats <= 0) continue;
    aggregateUsd += takeUsd;
    candidates.push({
      srcChain,
      srcSym: item.name || item.sym || "wBTC.OFT",
      dstChain,
      dstSym: "wBTC.OFT",
      sats,
      estimatedUsd: Number(takeUsd.toFixed(8)),
      sourceAmount: amount,
      sourceUsd: usd,
      reason: "idle_btc_family_wallet_inventory",
    });
  }

  candidates.sort((left, right) =>
    right.estimatedUsd - left.estimatedUsd ||
    left.srcChain.localeCompare(right.srcChain) ||
    left.srcSym.localeCompare(right.srcSym)
  );

  return {
    status: candidates.length > 0 ? "plan_ready" : "no_candidates",
    generatedAt: now,
    dstChain,
    threshold: {
      minIdleUsd,
      minIdleAgeMs,
      maxAggregateIdleUsd,
    },
    aggregateUsd: Number(aggregateUsd.toFixed(8)),
    candidates,
    skippedFamilies: ["protocol_positions", "native_gas", "cbBTC", "stable_or_rwa_tokens"],
  };
}
