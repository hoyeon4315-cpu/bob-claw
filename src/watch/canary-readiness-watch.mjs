import { tokenAsset } from "../assets/tokens.mjs";
import { EVM_CHAINS } from "../chains/registry.mjs";
import { config } from "../config/env.mjs";
import { STABLE_QUOTE_TOKENS } from "../dex/odos.mjs";
import { latestPriceSnapshot, priceForAssetUsd, pricesFromSnapshot } from "../market/prices.mjs";
import { sendTelegramMessage } from "../notify/telegram.mjs";
import { buildCanaryInputSummary } from "../status/canary-inputs.mjs";
import { buildDexEnvironmentSummary } from "../strategy/dex-environment.mjs";
import { buildDexRouteFocusSummary } from "../strategy/dex-route-focus.mjs";
export { buildNextReadinessCheckArgs, planNextReadinessRefresh } from "../estimator/readiness-refresh.mjs";

function observedAtMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function latestMatching(items = [], predicate) {
  let latest = null;
  let latestMs = null;
  for (const item of items) {
    if (!predicate(item)) continue;
    const itemMs = observedAtMs(item.observedAt);
    if (itemMs === null) continue;
    if (latestMs === null || itemMs > latestMs) {
      latest = item;
      latestMs = itemMs;
    }
  }
  return latest;
}

function splitObservationSequences(observations, maxGapMs) {
  const sequences = [];
  let current = [];
  let previousMs = null;
  for (const item of observations) {
    const itemMs = observedAtMs(item.observedAt);
    if (itemMs === null) continue;
    if (previousMs !== null && itemMs - previousMs > maxGapMs && current.length > 0) {
      sequences.push(current);
      current = [];
    }
    current.push(item);
    previousMs = itemMs;
  }
  if (current.length > 0) sequences.push(current);
  return sequences;
}

export function planGasRefresh(state) {
  const nextStep = state?.nextStep || state || null;
  const route = nextStep?.route || null;
  const sourceChain = route?.srcChain || null;
  const base = {
    shouldRefresh: false,
    reason: "not_applicable",
    routeKey: route?.routeKey || null,
    amount: route?.amount || null,
    chains: sourceChain && EVM_CHAINS[sourceChain] ? [sourceChain] : [],
  };
  if (!nextStep || nextStep.decision !== "BLOCKED_NO_VIABLE_PREP_ROUTE") return base;
  const reasons = nextStep.reasons || [];
  if (!(reasons.length > 0 && reasons.every((reason) => reason === "stale_src_gas_snapshot"))) {
    return { ...base, reason: "not_stale_src_gas_blocked" };
  }
  if (!route?.routeKey || !route?.amount) {
    return { ...base, reason: "route_missing" };
  }
  if (!sourceChain || !EVM_CHAINS[sourceChain]) {
    return { ...base, reason: "src_chain_not_supported" };
  }
  return {
    ...base,
    shouldRefresh: true,
    reason: "stale_src_gas_snapshot",
  };
}

export function shouldRefreshGasForCanary(nextStep) {
  if (!nextStep) return false;
  if (nextStep.decision !== "BLOCKED_NO_VIABLE_PREP_ROUTE") return false;
  const reasons = nextStep.reasons || [];
  return reasons.length > 0 && reasons.every((reason) => reason === "stale_src_gas_snapshot");
}

export function buildGasRefreshSnapshotArgs(refresh) {
  if (refresh?.chains?.length > 0) {
    return [`--chains=${refresh.chains.join(",")}`];
  }
  return [];
}

export function buildGasRefreshScoringArgs(refresh) {
  if (refresh?.routeKey && refresh?.amount) {
    return [
      "--write",
      `--route-key=${refresh.routeKey}`,
      `--amount=${refresh.amount}`,
    ];
  }
  return ["--write"];
}

export function planBlockedScoreRefresh(state) {
  const nextStep = state?.nextStep || null;
  const route = nextStep?.route || null;
  const scoreObservedAt = state?.scoreSnapshot?.generatedAt || null;
  const base = {
    shouldRefresh: false,
    reason: "not_applicable",
    routeKey: route?.routeKey || null,
    amount: route?.amount || null,
    scoreObservedAt,
    latestObservedAt: null,
    changedInputs: [],
  };

  if (!route || nextStep?.decision !== "BLOCKED_NO_VIABLE_PREP_ROUTE") {
    return base;
  }
  const reasons = nextStep.reasons || [];
  if (reasons.length !== 1 || reasons[0] !== "reject_no_net_edge") {
    return { ...base, reason: "not_net_edge_blocked" };
  }
  if (!scoreObservedAt) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "score_missing",
      changedInputs: ["score_missing"],
    };
  }

  const matchedScore = (state?.scoreSnapshot?.scores || []).find(
    (item) => item.routeKey === route.routeKey && String(item.amount) === String(route.amount),
  ) || null;
  const latestObservedPrices = latestPriceSnapshot(state?.priceSnapshots || []);
  const snapshotPrices = latestObservedPrices ? pricesFromSnapshot(latestObservedPrices) : null;
  const srcAsset = route.srcChain && route.srcToken ? tokenAsset(route.srcChain, route.srcToken) : null;
  const dstAsset = route.dstChain && route.dstToken ? tokenAsset(route.dstChain, route.dstToken) : null;

  const latestQuote = latestMatching(state?.quotes, (item) => item.routeKey === route.routeKey && String(item.amount) === String(route.amount));
  const latestExactGas = latestMatching(
    state?.gasEstimateSnapshots,
    (item) => item.routeKey === route.routeKey && String(item.amount) === String(route.amount),
  );
  const latestDexQuote = latestMatching(
    state?.dexQuotes,
    (item) => item.source === "gateway_dst_leg" && item.gatewayRouteKey === route.routeKey,
  );
  const latestSrcGasSnapshot = latestMatching(state?.gasSnapshots, (item) => item.chain === route.srcChain);
  const latestBitcoinFee = route.srcChain === "bitcoin" || route.dstChain === "bitcoin" ? latestMatching(state?.bitcoinFeeSnapshots, () => true) : null;

  const relevantInputs = [
    latestQuote ? { type: "quote", observedAt: latestQuote.observedAt } : null,
    latestExactGas ? { type: "exact_gas", observedAt: latestExactGas.observedAt } : null,
    latestDexQuote ? { type: "dex_quote", observedAt: latestDexQuote.observedAt } : null,
    latestSrcGasSnapshot ? { type: "src_gas_snapshot", observedAt: latestSrcGasSnapshot.observedAt } : null,
    latestBitcoinFee ? { type: "bitcoin_fee", observedAt: latestBitcoinFee.observedAt } : null,
  ].filter(Boolean);

  const scoreObservedAtMs = observedAtMs(scoreObservedAt);
  const changedInputs = relevantInputs
    .filter((item) => {
      const itemMs = observedAtMs(item.observedAt);
      return scoreObservedAtMs !== null && itemMs !== null && itemMs > scoreObservedAtMs;
    })
    .sort((left, right) => observedAtMs(right.observedAt) - observedAtMs(left.observedAt));
  if (latestObservedPrices && matchedScore?.price && observedAtMs(latestObservedPrices.observedAt) > scoreObservedAtMs) {
    const srcPriceChanged = priceForAssetUsd(srcAsset, snapshotPrices) !== matchedScore.price.srcRawUsd;
    const dstPriceChanged = priceForAssetUsd(dstAsset, snapshotPrices) !== matchedScore.price.dstRawUsd;
    if (srcPriceChanged) {
      changedInputs.push({ type: "src_price", observedAt: latestObservedPrices.observedAt });
    }
    if (dstPriceChanged) {
      changedInputs.push({ type: "dst_price", observedAt: latestObservedPrices.observedAt });
    }
    changedInputs.sort((left, right) => observedAtMs(right.observedAt) - observedAtMs(left.observedAt));
  }
  const newestRelevant = [...relevantInputs].sort((left, right) => observedAtMs(right.observedAt) - observedAtMs(left.observedAt))[0] || null;

  if (changedInputs.length > 0) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "newer_market_inputs",
      latestObservedAt: changedInputs[0].observedAt,
      changedInputs: changedInputs.map((item) => item.type),
    };
  }

  return {
    ...base,
    reason: "score_inputs_unchanged",
    latestObservedAt: newestRelevant?.observedAt || null,
  };
}

export function buildBlockedScoreRefreshScoringArgs(refresh, route = null) {
  const changedInputs = refresh?.changedInputs || [];
  const touchChains = [...new Set([route?.srcChain, route?.dstChain].filter(Boolean))];
  const broadInputTypes = new Set(["src_price", "dst_price", "src_gas_snapshot", "bitcoin_fee"]);
  if (touchChains.length > 0 && changedInputs.some((item) => broadInputTypes.has(item))) {
    return [
      "--write",
      `--touch-chains=${touchChains.join(",")}`,
    ];
  }
  if (refresh?.routeKey && refresh?.amount) {
    return [
      "--write",
      `--route-key=${refresh.routeKey}`,
      `--amount=${refresh.amount}`,
    ];
  }
  return ["--write"];
}

export function describeBlockedScoreRefreshSelection(refresh, route = null) {
  const args = buildBlockedScoreRefreshScoringArgs(refresh, route);
  const touchChainsArg = args.find((item) => item.startsWith("--touch-chains="));
  if (touchChainsArg) {
    return {
      scope: "touch_chains",
      chains: touchChainsArg.slice("--touch-chains=".length).split(",").filter(Boolean),
    };
  }
  return {
    scope: "route",
    chains: [],
  };
}

export function planQuoteDecayRefresh(state, options = {}) {
  const route = state?.nextStep?.route || null;
  const now = options.now || new Date().toISOString();
  const windowsSeconds = (options.windowsSeconds || [5, 15, 30]).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const maxWindowSeconds = windowsSeconds.at(-1) || 0;
  const base = {
    shouldRefresh: false,
    reason: "not_applicable",
    routeKey: route?.routeKey || null,
    amount: route?.amount || null,
    latestObservedAt: null,
    anchorObservedAt: null,
    pendingWindowSeconds: null,
  };

  if (!route?.routeKey || !route?.amount || windowsSeconds.length === 0) return base;

  const matching = (state?.shadowObservations || [])
    .filter((item) => item.routeKey === route.routeKey && String(item.amount) === String(route.amount))
    .sort((left, right) => observedAtMs(left.observedAt) - observedAtMs(right.observedAt));

  if (matching.length === 0) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "missing_decay_observation",
    };
  }

  const sequences = splitObservationSequences(matching, maxWindowSeconds * 1000);
  const activeSequence = sequences.at(-1) || [];
  const anchor = activeSequence[0] || null;
  const latest = activeSequence.at(-1) || null;
  const anchorMs = observedAtMs(anchor?.observedAt);
  const nowMs = observedAtMs(now);
  const coveredWindows = new Set();

  for (const item of activeSequence.slice(1)) {
    const itemMs = observedAtMs(item.observedAt);
    if (anchorMs === null || itemMs === null) continue;
    const elapsedSeconds = (itemMs - anchorMs) / 1000;
    for (const windowSeconds of windowsSeconds) {
      if (elapsedSeconds >= windowSeconds) coveredWindows.add(windowSeconds);
    }
  }

  const pendingWindowSeconds = windowsSeconds.find((windowSeconds) => !coveredWindows.has(windowSeconds)) || null;
  if (!pendingWindowSeconds) {
    return {
      ...base,
      reason: "decay_windows_complete",
      latestObservedAt: latest?.observedAt || null,
      anchorObservedAt: anchor?.observedAt || null,
    };
  }

  if (anchorMs === null || nowMs === null || nowMs - anchorMs < pendingWindowSeconds * 1000) {
    return {
      ...base,
      reason: "waiting_decay_window",
      latestObservedAt: latest?.observedAt || null,
      anchorObservedAt: anchor?.observedAt || null,
      pendingWindowSeconds,
    };
  }

  return {
    ...base,
    shouldRefresh: true,
    reason: "due_decay_window",
    latestObservedAt: latest?.observedAt || null,
    anchorObservedAt: anchor?.observedAt || null,
    pendingWindowSeconds,
  };
}

export function planDexPriceRefresh(state) {
  const route = state?.nextStep?.route || null;
  const marketPrices = state?.dashboardStatus?.market?.chainWbtcPrices || [];
  const marketByChain = new Map(marketPrices.map((item) => [item.chain, item]));
  const candidateChains = [...new Set([route?.srcChain, route?.dstChain].filter(Boolean))]
    .filter((chain) => chain !== "bitcoin" && STABLE_QUOTE_TOKENS[chain]);
  const quoteableChains = marketPrices
    .filter((item) => item?.chain !== "bitcoin" && item?.quoteable)
    .map((item) => item.chain);
  const base = {
    shouldRefresh: false,
    reason: "not_applicable",
    routeKey: route?.routeKey || null,
    amount: route?.amount || null,
    chains: candidateChains,
  };

  if (route && candidateChains.length > 0) {
    const missingChains = candidateChains.filter((chain) => !Number.isFinite(marketByChain.get(chain)?.usd));
    const staleChains = candidateChains.filter((chain) => marketByChain.get(chain)?.stale);

    if (missingChains.length > 0) {
      return {
        ...base,
        shouldRefresh: true,
        reason: "missing_chain_price",
        chains: missingChains,
      };
    }

    if (staleChains.length > 0) {
      return {
        ...base,
        shouldRefresh: true,
        reason: "stale_chain_price",
        chains: staleChains,
      };
    }
  }

  const missingGatewayChains = quoteableChains.filter((chain) => !Number.isFinite(marketByChain.get(chain)?.usd));
  const staleGatewayChains = quoteableChains.filter((chain) => Number.isFinite(marketByChain.get(chain)?.usd) && marketByChain.get(chain)?.stale);

  if (missingGatewayChains.length > 0) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "missing_gateway_chain_price",
      routeKey: null,
      amount: null,
      chains: missingGatewayChains,
    };
  }

  if (staleGatewayChains.length > 0) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "stale_gateway_chain_price",
      routeKey: null,
      amount: null,
      chains: staleGatewayChains,
    };
  }

  return {
    ...base,
    reason: "chain_prices_fresh",
    chains: quoteableChains.length > 0 ? quoteableChains : candidateChains,
  };
}

export function buildDexRefreshScoringArgs(refresh) {
  if (refresh?.routeKey && refresh?.amount) {
    return [
      "--write",
      `--route-key=${refresh.routeKey}`,
      `--amount=${refresh.amount}`,
    ];
  }
  if (refresh?.chains?.length > 0) {
    return [
      "--write",
      `--dst-chains=${refresh.chains.join(",")}`,
    ];
  }
  return ["--write"];
}

function collectRefreshInputKeys(summary) {
  if (!summary) return [];
  return [
    ["gatewayQuote", "gateway_quote"],
    ["exactGas", "exact_gas"],
    ["srcGas", "src_gas"],
    ["dexQuote", "dex_quote"],
    ["bitcoinFee", "bitcoin_fee"],
    ["marketSnapshot", "market"],
  ]
    .filter(([field]) => {
      const state = summary[field]?.state;
      return state === "missing" || state === "stale";
    })
    .map(([, key]) => key);
}

export function planCanaryInputRefresh(state, options = {}) {
  const now = options.now || state?.dashboardStatus?.generatedAt || new Date().toISOString();
  const route = state?.nextStep?.route || null;
  const summary = state?.dashboardStatus?.canaryInputs || buildCanaryInputSummary(state, { now });
  const inputKeys = collectRefreshInputKeys(summary);
  const hasMissing = inputKeys.some((key) => {
    const field = {
      gateway_quote: "gatewayQuote",
      exact_gas: "exactGas",
      src_gas: "srcGas",
      dex_quote: "dexQuote",
      bitcoin_fee: "bitcoinFee",
      market: "marketSnapshot",
    }[key];
    return summary?.[field]?.state === "missing";
  });
  const base = {
    shouldRefresh: false,
    reason: "not_applicable",
    routeKey: summary?.routeKey || route?.routeKey || null,
    amount: summary?.amount || route?.amount || null,
    routeLabel: summary?.routeLabel || route?.label || null,
    srcChain: route?.srcChain || null,
    dstChain: route?.dstChain || null,
    inputKeys,
  };

  if (!route?.routeKey || !route?.amount || !summary?.routeKey) {
    return {
      ...base,
      reason: "no_active_canary_route",
    };
  }

  if (inputKeys.length === 0) {
    return {
      ...base,
      reason: "canary_route_inputs_fresh",
    };
  }

  return {
    ...base,
    shouldRefresh: true,
    reason: hasMissing ? "missing_canary_route_inputs" : "stale_canary_route_inputs",
  };
}

export function buildCanaryInputRefreshVerifyArgs(refresh) {
  if (!refresh?.routeKey || !refresh?.amount || !refresh?.inputKeys?.includes("gateway_quote")) return null;
  return [
    `--route-key=${refresh.routeKey}`,
    `--amounts=${refresh.amount}`,
  ];
}

export function buildCanaryInputRefreshExactGasArgs(refresh, address) {
  if (!refresh?.routeKey || !refresh?.amount || !address || !refresh?.inputKeys?.includes("exact_gas")) return null;
  return [
    `--from=${address}`,
    `--route-key=${refresh.routeKey}`,
    `--amount=${refresh.amount}`,
  ];
}

export function buildCanaryInputRefreshGasSnapshotArgs(refresh) {
  if (!refresh?.srcChain || !refresh?.inputKeys?.includes("src_gas")) return null;
  return [`--chains=${refresh.srcChain}`];
}

export function buildCanaryInputRefreshDexArgs(refresh) {
  if (!refresh?.routeKey || !refresh?.amount || !refresh?.inputKeys?.includes("dex_quote")) return null;
  return [
    `--route-key=${refresh.routeKey}`,
    `--amount=${refresh.amount}`,
  ];
}

export function buildCanaryInputRefreshScoringArgs(refresh) {
  if (!refresh?.routeKey || !refresh?.amount) return ["--write"];
  return [
    "--write",
    `--route-key=${refresh.routeKey}`,
    `--amount=${refresh.amount}`,
  ];
}

export function planDexGatewayCoverageRefresh(state) {
  const summary =
    state?.dashboardStatus?.strategy?.dexRouteFocus ||
    buildDexRouteFocusSummary({
      routes: state?.routesRecords?.at(-1)?.routes || [],
      quotes: state?.quotes || [],
      scoreSnapshot: state?.scoreSnapshot || null,
      dexQuotes: state?.dexQuotes || [],
    });
  const targetRoutes = (summary?.routes || [])
    .filter((item) => item.classification === "missing_gateway_quote")
    .slice(0, 3)
    .map((item) => ({
      routeKey: item.routeKey,
      srcChain: item.srcChain,
      dstChain: item.dstChain,
      classification: item.classification,
    }));
  const base = {
    shouldRefresh: false,
    reason: "not_applicable",
    routeKey: targetRoutes[0]?.routeKey || null,
    classification: targetRoutes[0]?.classification || null,
    targetRouteCount: targetRoutes.length,
    targetRoutes,
    touchChains: [...new Set(targetRoutes.flatMap((item) => [item.srcChain, item.dstChain].filter(Boolean)))],
    sampleAmounts: config.sampleSats,
  };

  if (!summary || (summary.fullyMeasurableRouteCount || 0) === 0) {
    return {
      ...base,
      reason: "no_fully_measurable_routes",
    };
  }

  if ((summary.missingGatewayQuoteCount || 0) > 0 && targetRoutes.length > 0) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "missing_gateway_focus_quotes",
    };
  }

  return {
    ...base,
    reason: "gateway_focus_covered",
  };
}

export function buildDexGatewayCoverageVerifyArgs(target, refresh = null) {
  const args = [];
  if (target?.routeKey) args.push(`--route-key=${target.routeKey}`);
  if (refresh?.sampleAmounts?.length) args.push(`--amounts=${refresh.sampleAmounts.join(",")}`);
  return args;
}

export function buildDexGatewayCoverageDexQuoteArgs(target) {
  const args = ["--include-stable-entry"];
  if (target?.routeKey) args.push(`--route-key=${target.routeKey}`);
  return args;
}

export function buildDexGatewayCoverageScoringArgs(refresh) {
  if (refresh?.touchChains?.length > 0) {
    return [
      "--write",
      `--touch-chains=${refresh.touchChains.join(",")}`,
    ];
  }
  return ["--write"];
}

export function planDexEnvironmentRefresh(state) {
  const summary =
    state?.dashboardStatus?.strategy?.dexEnvironment ||
    buildDexEnvironmentSummary({
      dexQuotes: state?.dexQuotes || [],
    });
  const topRisk = summary?.topRiskRoute || null;
  const base = {
    shouldRefresh: false,
    reason: "not_applicable",
    routeKey: topRisk?.routeKey || null,
    amount: topRisk?.amount || null,
    classification: topRisk?.classification || null,
    targetRouteCount: summary?.monitoredRouteCount || 0,
    targetRoutes: [],
  };

  if (!summary || (summary.monitoredRouteCount || 0) === 0) {
    return {
      ...base,
      reason: "unmeasured_environment",
    };
  }

  const targetRoutes = (summary.routes || [])
    .filter((item) => item.classification !== "stable_enough_to_monitor")
    .slice(0, 3)
    .map((item) => ({
      routeKey: item.routeKey,
      amount: item.amount,
      classification: item.classification,
    }));

  if (summary.staleLegCount > 0 && topRisk?.classification === "refresh_needed") {
    return {
      ...base,
      shouldRefresh: true,
      reason: "stale_dex_environment",
      targetRouteCount: targetRoutes.length,
      targetRoutes,
    };
  }

  if (summary.thinLiquidityLegCount > 0) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "thin_liquidity_dex_environment",
      targetRouteCount: targetRoutes.length,
      targetRoutes,
    };
  }

  if (summary.unstableLegCount > 0) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "unstable_dex_environment",
      targetRouteCount: targetRoutes.length,
      targetRoutes,
    };
  }

  if (summary.singleSampleLegCount > 0) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "single_sample_dex_environment",
      targetRouteCount: targetRoutes.length,
      targetRoutes,
    };
  }

  return {
    ...base,
    reason: "dex_environment_stable",
    targetRouteCount: targetRoutes.length,
    targetRoutes,
  };
}

export function buildDexEnvironmentRefreshQuoteArgs(refresh) {
  const args = ["--include-stable-entry"];
  if (refresh?.routeKey && refresh?.amount) {
    return [
      ...args,
      `--route-key=${refresh.routeKey}`,
      `--amount=${refresh.amount}`,
    ];
  }
  return [...args, "--route-limit=24"];
}

export function formatCanaryWatchSummary(nextStep) {
  const lines = [
    `decision=${nextStep.decision}`,
    `headline=${nextStep.headline}`,
  ];
  if (nextStep.route) {
    lines.push(`route=${nextStep.route.label} amount=${nextStep.route.amount}`);
  }
  if (nextStep.reasons?.length) {
    lines.push(`reasons=${nextStep.reasons.join(",")}`);
  }
  return lines.join("\n");
}

function parseStructuredOutput(output) {
  const summary = {};
  for (const line of String(output || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (!(key in summary)) summary[key] = value;
  }
  return summary;
}

function summarizeWriteState(summary, wroteKey, unchangedKey) {
  if (summary[wroteKey]) return "refresh";
  if (summary[unchangedKey]) return "skip";
  return "unknown";
}

export function summarizeShadowArtifactRefresh({ priceOutput = "", shadowOutput = "", dashboardOutput = "" } = {}) {
  const price = parseStructuredOutput(priceOutput);
  const shadow = parseStructuredOutput(shadowOutput);
  const dashboard = parseStructuredOutput(dashboardOutput);
  const priceState = price.failed ? "failed" : price.wrote ? `refresh:${price.reason || "updated"}` : price.skipped ? `skip:${price.skipped}` : "unknown";
  const shadowState = summarizeWriteState(shadow, "wrote", "unchanged");
  const localDashboardState = summarizeWriteState(dashboard, "wrote", "unchanged");
  const publicDashboardState = summarizeWriteState(dashboard, "dashboardWrote", "dashboardUnchanged");
  return `refresh=shadow-artifacts price=${priceState} shadow=${shadowState} dashboard=${localDashboardState}/${publicDashboardState}`;
}

export function formatCanaryTelegramAlert(nextStep) {
  const lines = [
    "BOB Claw canary update",
    `decision: ${nextStep.decision}`,
    `headline: ${nextStep.headline}`,
  ];
  if (nextStep.route) {
    lines.push(`route: ${nextStep.route.label}`);
    lines.push(`amount: ${nextStep.route.amount}`);
  }
  if (nextStep.reasons?.length) {
    lines.push(`reasons: ${nextStep.reasons.join(",")}`);
  }
  return lines.join("\n");
}

export function decisionFingerprint(nextStep) {
  return JSON.stringify({
    decision: nextStep.decision,
    routeKey: nextStep.route?.routeKey || null,
    amount: nextStep.route?.amount || null,
    reasons: nextStep.reasons || [],
  });
}

export async function notifyCanaryDecision({ botToken, chatId, nextStep, fetchImpl = fetch }) {
  return sendTelegramMessage({
    botToken,
    chatId,
    text: formatCanaryTelegramAlert(nextStep),
    fetchImpl,
  });
}
