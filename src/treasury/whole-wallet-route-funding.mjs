import { ZERO_TOKEN, tokenAsset } from "../assets/tokens.mjs";

function normalized(value) {
  return String(value || "").toLowerCase();
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function weiToUsd(wei, nativePriceUsd) {
  if (!Number.isFinite(nativePriceUsd)) return null;
  return (Number(BigInt(wei || 0)) / 1e18) * nativePriceUsd;
}

function nativeUnitPriceUsd(entry) {
  if (!Number.isFinite(entry?.estimatedUsd) || !Number.isFinite(entry?.actualDecimal) || !(entry.actualDecimal > 0)) {
    return null;
  }
  return entry.estimatedUsd / entry.actualDecimal;
}

function sortCandidates(items = []) {
  return [...items].sort((left, right) => {
    if ((left.priority || 0) !== (right.priority || 0)) return (left.priority || 0) - (right.priority || 0);
    const leftUsd = Number.isFinite(left.estimatedUsd) ? left.estimatedUsd : -1;
    const rightUsd = Number.isFinite(right.estimatedUsd) ? right.estimatedUsd : -1;
    if (leftUsd !== rightUsd) return rightUsd - leftUsd;
    return String(left.chain || "").localeCompare(String(right.chain || ""));
  });
}

function candidate(source, overrides = {}) {
  return {
    chain: source.chain,
    token: source.token || ZERO_TOKEN,
    ticker: source.ticker,
    family: source.family,
    estimatedUsd: finite(source.estimatedUsd),
    actualDecimal: finite(source.actualDecimal),
    rpcUrl: source.rpcUrl || null,
    ...overrides,
  };
}

function assetUnitUsd(candidateEntry) {
  if (!Number.isFinite(candidateEntry?.estimatedUsd) || !Number.isFinite(candidateEntry?.actualDecimal) || !(candidateEntry.actualDecimal > 0)) {
    return null;
  }
  return candidateEntry.estimatedUsd / candidateEntry.actualDecimal;
}

function ceilUnitsFromDecimalAmount(amountDecimal, decimals) {
  if (!Number.isFinite(amountDecimal) || !(amountDecimal > 0) || !Number.isFinite(decimals) || decimals < 0) {
    return null;
  }
  const scaled = Math.ceil(amountDecimal * 10 ** decimals);
  return scaled > 0 ? String(scaled) : null;
}

export function estimateRecommendationProbeAmount({ plan, recommendation, category }) {
  if (!plan || !recommendation) return null;
  const sourceAsset = tokenAsset(recommendation.chain, recommendation.token);
  const srcAsset = tokenAsset(plan.srcChain, plan.srcToken);

  if (category === "token") {
    const shortfallUnits = String(plan.readiness?.tokenShortfall || "0");
    if (BigInt(shortfallUnits) <= 0n) return null;
    if (recommendation.family === srcAsset.family && sourceAsset.decimals === srcAsset.decimals) {
      return shortfallUnits;
    }
    return null;
  }

  if (category === "native") {
    const targetUsd = Number(plan.readiness?.nativeShortfallUsd);
    const sourceUnitPriceUsd = assetUnitUsd(recommendation);
    if (!Number.isFinite(targetUsd) || !(targetUsd > 0) || !Number.isFinite(sourceUnitPriceUsd) || !(sourceUnitPriceUsd > 0)) {
      return null;
    }
    return ceilUnitsFromDecimalAmount((targetUsd * 1.1) / sourceUnitPriceUsd, sourceAsset.decimals);
  }

  return null;
}

function summarizeProbe({ category, recommendation, probeAmount, preview, plan }) {
  const shortfallToken = String(plan.readiness?.tokenShortfall || "0");
  const shortfallNativeWei = String(plan.readiness?.nativeShortfallWei || "0");
  const quoteOutputAmount = preview?.quote?.outputAmount || null;
  const coversShortfall = category === "token"
    ? Boolean(preview?.planStatus === "ready" && quoteOutputAmount && BigInt(quoteOutputAmount) >= BigInt(shortfallToken))
    : Boolean(preview?.planStatus === "ready" && quoteOutputAmount && BigInt(quoteOutputAmount) >= BigInt(shortfallNativeWei));
  return {
    category,
    chain: recommendation.chain,
    method: recommendation.method,
    inputToken: recommendation.token,
    inputTicker: recommendation.ticker,
    probeAmount,
    status: preview?.planStatus || "unavailable",
    blockedReason: preview?.blockedReason || null,
    quoteObservedAt: preview?.quote?.observedAt || null,
    pathId: preview?.quote?.pathId || null,
    quoteOutputAmount,
    quoteOutputUsd: preview?.quote?.outputValueUsd ?? null,
    gasEstimateValueUsd: preview?.quote?.gasEstimateValueUsd ?? null,
    minimumOutputAmount: preview?.minimumOutputAmount || null,
    coversShortfall,
  };
}

export async function probeWholeWalletFundingRecommendations({
  plan,
  senderAddress,
  buildTokenDexPlanImpl,
} = {}) {
  if (!plan || typeof buildTokenDexPlanImpl !== "function" || !senderAddress) {
    return null;
  }

  const sameChainTokenCandidate = (plan.recommendations?.tokenTopUps || []).find(
    (item) => item.chain === plan.srcChain && item.method === "same_chain_token_swap",
  ) || null;
  const sameChainNativeCandidate = (plan.recommendations?.nativeTopUps || []).find(
    (item) => item.chain === plan.srcChain && item.method === "same_chain_token_to_native_swap",
  ) || null;

  const result = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    senderAddress,
    tokenProbe: null,
    nativeProbe: null,
  };

  if (sameChainTokenCandidate) {
    const probeAmount = estimateRecommendationProbeAmount({
      plan,
      recommendation: sameChainTokenCandidate,
      category: "token",
    });
    if (probeAmount) {
      const preview = await buildTokenDexPlanImpl({
        chain: plan.srcChain,
        amount: probeAmount,
        senderAddress,
        inputToken: sameChainTokenCandidate.token,
        outputToken: plan.srcToken,
      });
      result.tokenProbe = summarizeProbe({
        category: "token",
        recommendation: sameChainTokenCandidate,
        probeAmount,
        preview,
        plan,
      });
    }
  }

  if (sameChainNativeCandidate) {
    const probeAmount = estimateRecommendationProbeAmount({
      plan,
      recommendation: sameChainNativeCandidate,
      category: "native",
    });
    if (probeAmount) {
      const preview = await buildTokenDexPlanImpl({
        chain: plan.srcChain,
        amount: probeAmount,
        senderAddress,
        inputToken: sameChainNativeCandidate.token,
        outputToken: "native",
      });
      result.nativeProbe = summarizeProbe({
        category: "native",
        recommendation: sameChainNativeCandidate,
        probeAmount,
        preview,
        plan,
      });
    }
  }

  return result;
}

export function buildWholeWalletRouteFundingPlan({ scan = null, readiness = null } = {}) {
  if (!scan || !readiness) {
    return {
      schemaVersion: 1,
      status: "missing_inputs",
      blockers: ["whole_wallet_scan_missing", "wallet_readiness_missing"].filter((code, index) =>
        [!scan, !readiness][index],
      ),
    };
  }

  const srcChain = readiness.srcChain;
  const srcToken = readiness.srcToken;
  const srcAsset = tokenAsset(srcChain, srcToken);
  const nativeShortfallWei = readiness.native?.shortfallWei || readiness.native?.shortfall || "0";
  const tokenShortfallUnits = readiness.token?.shortfall || "0";
  const srcNativeEntry = (scan.native || []).find((item) => item.chain === srcChain) || null;
  const nativeShortfallUsd = weiToUsd(nativeShortfallWei, nativeUnitPriceUsd(srcNativeEntry));

  const sameChainNative = (scan.native || []).filter((item) => item.chain === srcChain);
  const sameChainTokens = (scan.tokenBalances || []).filter((item) => item.chain === srcChain);
  const crossChainNative = (scan.native || []).filter((item) => item.chain !== srcChain);
  const crossChainTokens = (scan.tokenBalances || []).filter((item) => item.chain !== srcChain);

  const nativeCandidates = [];
  const tokenCandidates = [];

  if (BigInt(nativeShortfallWei) > 0n) {
    for (const entry of sameChainTokens) {
      nativeCandidates.push(
        candidate(entry, {
          method: "same_chain_token_to_native_swap",
          reason: "same_chain_token_can_cover_native_gap",
          priority: entry.family === srcAsset.family ? 0 : 1,
        }),
      );
    }
    for (const entry of crossChainNative) {
      nativeCandidates.push(
        candidate(entry, {
          method: "cross_chain_bridge_or_swap",
          reason: "cross_chain_native_can_fund_src_gas",
          priority: 2,
        }),
      );
    }
    for (const entry of crossChainTokens) {
      nativeCandidates.push(
        candidate(entry, {
          method: "cross_chain_bridge_or_swap",
          reason: "cross_chain_token_can_be_converted_to_src_gas",
          priority: entry.family === srcAsset.family ? 2 : 3,
        }),
      );
    }
  }

  if (BigInt(tokenShortfallUnits) > 0n) {
    for (const entry of sameChainTokens.filter((item) => normalized(item.token) !== normalized(srcToken))) {
      tokenCandidates.push(
        candidate(entry, {
          method: "same_chain_token_swap",
          reason: entry.family === srcAsset.family ? "same_chain_same_family_swap" : "same_chain_token_swap",
          priority: entry.family === srcAsset.family ? 0 : 1,
        }),
      );
    }
    for (const entry of sameChainNative) {
      tokenCandidates.push(
        candidate(entry, {
          method: "same_chain_native_to_token_swap",
          reason: "same_chain_native_swap",
          priority: 2,
        }),
      );
    }
    for (const entry of crossChainTokens) {
      tokenCandidates.push(
        candidate(entry, {
          method: "cross_chain_bridge_or_swap",
          reason: entry.family === srcAsset.family ? "cross_chain_same_family_source" : "cross_chain_token_source",
          priority: entry.family === srcAsset.family ? 3 : 4,
        }),
      );
    }
  }

  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    status: readiness.overallReady ? "already_ready" : "route_funding_required",
    routeKey: readiness.routeKey,
    amount: readiness.amount,
    srcChain,
    srcToken,
    srcTicker: readiness.srcTicker || srcAsset.ticker,
    readiness: {
      overallReady: readiness.overallReady,
      nativeShortfallWei,
      nativeShortfallUsd: finite(nativeShortfallUsd),
      tokenShortfall: tokenShortfallUnits,
    },
    recommendations: {
      nativeTopUps: sortCandidates(nativeCandidates).slice(0, 5),
      tokenTopUps: sortCandidates(tokenCandidates).slice(0, 5),
    },
  };
}
