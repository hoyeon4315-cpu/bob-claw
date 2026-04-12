#!/usr/bin/env node

import { join } from "node:path";
import { classifyGatewayAssetUniverse } from "../assets/tokens.mjs";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { loadCanaryState } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCanaryInputSummary, buildCanaryStageChecklist, buildExecutionStageSummary } from "../status/canary-inputs.mjs";
import { buildCrossAssetArbitrageSummary } from "../strategy/cross-asset-arbitrage.mjs";
import { buildDexEnvironmentSummary } from "../strategy/dex-environment.mjs";
import { buildDexRouteFocusSummary } from "../strategy/dex-route-focus.mjs";
import { buildDexGatewayArbitrageSummary } from "../strategy/dex-gateway-arbitrage.mjs";
import { buildDexRouteUniverseSummary } from "../strategy/dex-route-universe.mjs";
import { buildEdgeViabilitySummary, buildEdgeViabilityVerdict } from "../strategy/edge-viability.mjs";
import { buildEdgeResearchSummary } from "../strategy/edge-research.mjs";
import { buildNoEdgePersistenceSummary } from "../strategy/no-edge-persistence.mjs";
import { buildProfitabilitySummary } from "../strategy/profitability-summary.mjs";
import {
  planCanaryInputRefresh,
  describeBlockedScoreRefreshSelection,
  planBlockedScoreRefresh,
  planDexGatewayCoverageRefresh,
  planDexPriceRefresh,
  planGasRefresh,
  planQuoteDecayRefresh,
} from "../watch/canary-readiness-watch.mjs";

const OUTPUT_PATH = "docs/current-status.md";

function normalizeCurrentStatusDoc(doc) {
  return String(doc || "").replace(/^Updated: .*\n/m, "Updated: <volatile>\n");
}

function money(value) {
  if (!Number.isFinite(value)) return "n/a";
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

function amount(value, ticker) {
  if (!Number.isFinite(value)) return `unknown ${ticker}`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value >= 1 ? 6 : 12 })} ${ticker}`;
}

function linesForActions(actions = []) {
  if (!actions.length) return ["- none"];
  return actions.map((action) => {
    if (action.type === "fund_native") return `- fund ${amount(action.shortfallDecimal, action.ticker)} on ${action.chain}`;
    if (action.type === "fund_token") return `- fund ${amount(action.shortfallDecimal, action.ticker)} on ${action.chain}`;
    if (action.type === "approve_allowance") {
      return `- approve ${amount(action.shortfallDecimal, action.ticker)} for spender ${action.spender} on ${action.chain}`;
    }
    if (action.type === "estimate_exact_gas") return `- run exact gas for ${action.routeKey} amount=${action.amount}`;
    if (action.type === "rerun_scoring") return `- rerun scoring for ${action.routeKey} amount=${action.amount}`;
    return `- ${action.type}`;
  });
}

function readinessRefreshLine(refresh) {
  if (!refresh) return "- Refresh status: no next readiness check";
  if (refresh.state === "ready_now") return "- Refresh status: ready to rerun the next wallet readiness check now";
  if (refresh.state === "cooldown") {
    const age = Number.isFinite(refresh.ageSeconds) ? `${refresh.ageSeconds}s ago` : "recently";
    const remaining =
      Number.isFinite(refresh.maxAgeSeconds) && Number.isFinite(refresh.ageSeconds)
        ? `${Math.max(0, refresh.maxAgeSeconds - refresh.ageSeconds)}s remaining`
        : "cooldown active";
    return `- Refresh status: last readiness observation ${age}; ${remaining}`;
  }
  return `- Refresh status: ${refresh.reason || "unknown"}`;
}

function tradeReadinessLine(best) {
  if (!best?.tradeReadiness) return "- Objective score blocker: none";
  if (best.tradeReadiness === "reject_no_net_edge") {
    return Number.isFinite(best.netEdgeUsd)
      ? `- Objective score blocker: reject_no_net_edge (net edge ${money(best.netEdgeUsd)})`
      : "- Objective score blocker: reject_no_net_edge";
  }
  return `- Objective score blocker: ${best.tradeReadiness}`;
}

function nextFocusLine(best) {
  if (!best?.tradeReadiness) return null;
  if (best.tradeReadiness === "reject_no_net_edge") {
    return "- Next focus: rerun quotes, gas, or token prices only when market inputs change; wallet readiness is no longer the blocker";
  }
  return null;
}

function quoteDecayLine(audit) {
  const windows = audit?.quoteDecayWindows || [];
  if (!windows.length) return "- Quote decay: no shadow decay windows yet";
  const required = windows.filter((item) => [5, 15, 30].includes(item.windowSeconds));
  if (!required.length) return "- Quote decay: no 5s/15s/30s windows yet";
  const withCoverage = required.filter((item) => (item.profitableStartGroups || item.coveredGroups || 0) > 0);
  if (!withCoverage.length) return "- Quote decay: collecting initial decay samples";
  return `- Quote decay: ${withCoverage
    .map((item) => `${item.windowSeconds}s ${item.survivedGroups}/${item.profitableStartGroups || item.coveredGroups}`)
    .join(" · ")}`;
}

function overfitAuditLines(audit) {
  if (!audit) return ["- Overfit audit: unavailable"];
  const blockers = audit.blockers?.join(", ") || "none";
  const warnings = audit.warningLabels?.join(", ") || "none";
  const lines = [
    `- Overfit audit: ${audit.decision} · sample=${audit.sampleSource || "unknown"} · horizon=${Number.isFinite(audit.shadowHours) ? `${audit.shadowHours.toFixed(1)}h` : "n/a"} · buckets=${audit.hourBuckets ?? "n/a"}`,
    `- Overfit blockers: ${blockers}`,
    `- Overfit warnings: ${warnings}`,
  ];
  if (Number.isFinite(audit.remainingShadowHours) || Number.isFinite(audit.remainingHourBuckets)) {
    lines.push(
      `- Overfit runway: ${Number.isFinite(audit.remainingShadowHours) ? `${audit.remainingShadowHours.toFixed(1)}h remaining to ${audit.targetShadowHours}h` : "shadow runway n/a"} · ${Number.isFinite(audit.remainingHourBuckets) ? `${audit.remainingHourBuckets} hourly buckets remaining to ${audit.targetHourBuckets}` : "bucket runway n/a"}`,
    );
  }
  if (audit.earliestShadowWindowReadyAt || audit.earliestHourBucketReadyAt || audit.earliestTimeGateReadyAt) {
    lines.push(
      `- Overfit time ETA: shadow window ${audit.earliestShadowWindowReadyAt || "n/a"} · bucket diversity ${audit.earliestHourBucketReadyAt || "n/a"} · earliest time-gate pass ${audit.earliestTimeGateReadyAt || "n/a"}`,
    );
  }
  return lines;
}

function priceCoverageLine(market) {
  if (!market) return "- Chain price coverage: unavailable";
  return `- Chain price coverage: observed ${market.observedChainCount ?? 0}, stale ${market.staleChainCount ?? 0}, missing ${market.missingChainCount ?? 0}`;
}

function coverageReasonLabel(reason) {
  return {
    dex_quote_observed: "observed",
    btc_spot_reference: "BTC spot reference",
    odos_chain_not_supported: "DEX unsupported",
    stable_quote_token_missing: "quote token missing",
    eligible_quote_not_run: "awaiting quote refresh",
    wrapped_btc_leg_not_sampled: "awaiting sample",
    odos_quote_failed: "recent quote failed",
    input_is_quote_stable: "stable pair skipped",
  }[reason || ""] || String(reason || "unknown");
}

function quoteableCoverageLine(market) {
  const prices = market?.chainWbtcPrices || [];
  const observed = prices.filter((item) => item?.quoteable && Number.isFinite(item?.usd)).map((item) => item.chain);
  const missing = prices
    .filter((item) => item?.quoteable && !Number.isFinite(item?.usd))
    .map((item) => `${item.chain}:${coverageReasonLabel(item.coverageReason)}`);
  const unsupported = prices
    .filter((item) => item?.chain !== "bitcoin" && !item?.quoteable)
    .map((item) => `${item.chain}:${coverageReasonLabel(item.coverageReason)}`);
  return [
    `- Quoteable chains observed: ${observed.join(",") || "none"}`,
    `- Quoteable chains missing: ${missing.join(",") || "none"}`,
    `- Non-quoteable chains: ${unsupported.join(",") || "none"}`,
  ];
}

function btcWatchlistLines(summary) {
  if (!summary) return ["- BTC watchlist coverage: unavailable"];
  return [
    `- BTC watchlist observed live: ${summary.observedTickers?.join(", ") || "none"}`,
    `- BTC watchlist missing from live routes: ${summary.missingTickers?.join(", ") || "none"}`,
    `- BTC watchlist unknown addresses: ${summary.unknownAssets?.map((item) => `${item.chain}:${item.token}`).join(", ") || "none"}`,
  ];
}

function buildBtcWatchlistFallbackSummary(routes = []) {
  const assetUniverse = classifyGatewayAssetUniverse(routes);
  const uniqueTickers = (items = []) => [...new Set(items.map((item) => item.ticker).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    observedTickers: uniqueTickers(assetUniverse.watchlistObserved),
    missingTickers: uniqueTickers(assetUniverse.watchlistMissing),
    unknownAssets: assetUniverse.unknownAssets.map((item) => ({
      chain: item.chain,
      token: item.token,
    })),
  };
}

function shadowRosterLines(routePlan) {
  const candidates = (routePlan?.topCandidates || []).slice(0, 5);
  if (!candidates.length) return ["- none"];
  return candidates.map((candidate, index) => {
    const role =
      index === 0 ? "active_canary" :
      candidate?.viableForPrep ? "prep_candidate" :
      candidate?.txReady ? "tx_ready_shadow" :
      "research_candidate";
    const blockers = [
      ...(candidate.prepBlockers || []).map((item) => `prep:${item}`),
      ...(candidate.scoreDisqualifiers || []).map((item) => `score:${item}`),
      ...(candidate.readinessFailureReason ? [`readiness:${candidate.readinessFailureReason}`] : []),
    ];
    return `- ${role} route=\`${candidate.label}\` amount=\`${candidate.amount}\` txReady=${Boolean(candidate.txReady)} viableForPrep=${Boolean(candidate.viableForPrep)} net=${money(candidate.netEdgeUsd)} prepFunding=${money(candidate.prepFundingUsd)} blockers=${blockers.join(",") || "none"}`;
  });
}

function watcherReasonLabel(kind, reason) {
  return {
    canaryInputs: {
      stale_canary_route_inputs: "current canary route inputs are stale",
      missing_canary_route_inputs: "current canary route inputs are missing",
      canary_route_inputs_fresh: "current canary route inputs are fresh",
      no_active_canary_route: "no active canary route",
      not_applicable: "canary input refresh not needed right now",
    },
    gasRefresh: {
      stale_src_gas_snapshot: "source gas snapshot is stale",
      not_stale_src_gas_blocked: "gas freshness is not the active blocker",
      route_missing: "route information is missing",
      src_chain_not_supported: "source chain is not an EVM gas snapshot target",
      not_applicable: "gas refresh not needed right now",
    },
    dexRefresh: {
      missing_chain_price: "current canary route chain price is missing",
      stale_chain_price: "current canary route chain price is stale",
      missing_gateway_chain_price: "quoteable gateway chain price is missing",
      stale_gateway_chain_price: "quoteable gateway chain price is stale",
      chain_prices_fresh: "observed chain prices are fresh",
      not_applicable: "dex refresh not needed right now",
    },
    blockedScore: {
      newer_market_inputs: "new market inputs arrived after the score snapshot",
      score_inputs_unchanged: "no new score inputs arrived",
      score_missing: "score snapshot is missing",
      not_net_edge_blocked: "blocker is not net edge",
      not_applicable: "blocked-score refresh not needed right now",
    },
    quoteDecay: {
      missing_decay_observation: "no decay observations yet",
      waiting_decay_window: "next decay window has not opened yet",
      due_decay_window: "next decay window is due now",
      decay_windows_complete: "baseline decay windows are already covered",
      not_applicable: "quote-decay refresh not needed right now",
    },
    gatewayCoverage: {
      missing_gateway_focus_quotes: "fully measurable route still needs a Gateway probe",
      gateway_focus_covered: "focus shortlist already has Gateway coverage",
      no_fully_measurable_routes: "no fully measurable DEX route subset yet",
      not_applicable: "gateway coverage refresh not needed right now",
    },
  }[kind]?.[reason] || reason || "unknown";
}

function gasRefreshLine(refresh) {
  if (!refresh?.routeKey) return "- Gas refresh watcher: no route selected";
  if (refresh.shouldRefresh) {
    return `- Gas refresh watcher: refresh ${refresh.chains.join(",") || "source-chain"} and rerun ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("gasRefresh", refresh.reason)})`;
  }
  return `- Gas refresh watcher: skip ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("gasRefresh", refresh.reason)})`;
}

function changedInputLabel(type) {
  return {
    quote: "gateway quote",
    exact_gas: "exact gas",
    dex_quote: "DEX quote",
    src_gas_snapshot: "source gas snapshot",
    bitcoin_fee: "bitcoin fee",
    src_price: "source price",
    dst_price: "destination price",
    score_missing: "missing score snapshot",
  }[type] || type;
}

function dexRefreshTargetCount(refresh, state) {
  const scores = state?.scoreSnapshot?.scores || [];
  if (refresh?.routeKey && refresh?.amount) {
    return scores.filter((item) => item.routeKey === refresh.routeKey && String(item.amount) === String(refresh.amount)).length;
  }
  return scores.filter((item) => refresh?.chains?.includes(item.dstChain) && item?.dstAsset?.family === "wrapped_btc").length;
}

function dexRefreshLine(refresh, state) {
  if (!refresh?.chains?.length) return "- DEX refresh watcher: no eligible chain set";
  const targetCount = dexRefreshTargetCount(refresh, state);
  const targetText = Number.isFinite(targetCount) ? `; rescoring ${targetCount} wrapped-BTC route(s)` : "";
  if (refresh.shouldRefresh) {
    const scope = refresh.routeKey && refresh.amount ? `route ${refresh.routeKey} amount=${refresh.amount}` : `dst chains ${refresh.chains.join(",")}`;
    return `- DEX refresh watcher: refresh ${scope}${targetText} (${watcherReasonLabel("dexRefresh", refresh.reason)})`;
  }
  return `- DEX refresh watcher: skip ${refresh.chains.join(",")}${targetText} (${watcherReasonLabel("dexRefresh", refresh.reason)})`;
}

function blockedScoreLine(refresh) {
  if (!refresh?.routeKey) return "- Blocked-score watcher: no route selected";
  const selection = describeBlockedScoreRefreshSelection(refresh, {
    srcChain: refresh.srcChain,
    dstChain: refresh.dstChain,
  });
  const scopeText = selection.scope === "touch_chains" ? `touching ${selection.chains.join(",")}; ` : "";
  const inputs = refresh.changedInputs.map(changedInputLabel).join(", ") || "inputs unknown";
  if (refresh.shouldRefresh) {
    return `- Blocked-score watcher: rerun ${scopeText}${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("blockedScore", refresh.reason)}; ${inputs})`;
  }
  return `- Blocked-score watcher: skip ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("blockedScore", refresh.reason)})`;
}

function quoteDecayRefreshLine(refresh) {
  if (!refresh?.routeKey) return "- Quote-decay watcher: no route selected";
  if (refresh.shouldRefresh) {
    return `- Quote-decay watcher: refresh ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("quoteDecay", refresh.reason)}; window ${refresh.pendingWindowSeconds || "n/a"}s)`;
  }
  return `- Quote-decay watcher: skip ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("quoteDecay", refresh.reason)}${refresh.pendingWindowSeconds ? `; window ${refresh.pendingWindowSeconds}s` : ""})`;
}

function canaryInputRefreshLine(refresh) {
  if (!refresh?.routeKey) return "- Canary input watcher: no active canary route";
  const inputs = refresh.inputKeys?.join(",") || "none";
  if (refresh.shouldRefresh) {
    return `- Canary input watcher: refresh ${refresh.routeKey} amount=${refresh.amount} inputs=${inputs} (${watcherReasonLabel("canaryInputs", refresh.reason)})`;
  }
  return `- Canary input watcher: skip ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("canaryInputs", refresh.reason)})`;
}

function gatewayCoverageLine(refresh) {
  if (!refresh?.targetRouteCount) return "- Gateway coverage watcher: no fully measurable route shortlist yet";
  const targets = (refresh.targetRoutes || []).map((item) => item.routeKey).join(", ") || "none";
  const chains = refresh.touchChains?.join(",") || "none";
  if (refresh.shouldRefresh) {
    return `- Gateway coverage watcher: probe ${refresh.targetRouteCount} focus route(s) (${targets}) and rescore chains ${chains} (${watcherReasonLabel("gatewayCoverage", refresh.reason)})`;
  }
  return `- Gateway coverage watcher: skip ${refresh.targetRouteCount} focus route(s) (${watcherReasonLabel("gatewayCoverage", refresh.reason)})`;
}

function lastAdvanceLine(advance) {
  if (!advance) return "- Last canary advance: none recorded";
  const actions = (advance.actions || []).join(", ") || "no_actions";
  const initial = advance.initial?.decision || "unknown";
  const final = advance.final?.decision || "unknown";
  const route = advance.final?.routeLabel || advance.initial?.routeLabel || "no_route";
  return `- Last canary advance: ${route} (${initial} -> ${final}; actions ${actions})`;
}

function freshnessText(name, item) {
  const ageText = Number.isFinite(item?.ageMinutes) ? `${item.ageMinutes.toFixed(1)}m` : "n/a";
  return `${name} ${item?.state || "unknown"}${item?.state === "fresh" || item?.state === "stale" ? ` (${ageText})` : ""}`;
}

function canaryInputsLines(summary) {
  if (!summary) return ["- Route input freshness: no active canary route"];
  return [
    `- Route input freshness: ${[
      freshnessText("quote", summary.gatewayQuote),
      freshnessText("exactGas", summary.exactGas),
      freshnessText("srcGas", summary.srcGas),
      freshnessText("dex", summary.dexQuote),
      freshnessText("btcFee", summary.bitcoinFee),
      freshnessText("market", summary.marketSnapshot),
    ].join(" · ")}`,
    `- Route input blockers: ${summary.blockers.join(",") || "none"}${summary.scoreDataGaps?.length ? `; score gaps ${summary.scoreDataGaps.join(",")}` : ""}`,
  ];
}

function checklistLines(checklist) {
  return [
    `- Completed so far: ${checklist?.completed?.join(" · ") || "none yet"}`,
    `- Remaining steps: ${checklist?.remaining?.join(" · ") || "none"}`,
  ];
}

function executionStageLines(summary) {
  return [
    `- Manual canary review: ${summary.reviewStage}${summary.reviewReasons.length ? ` (${summary.reviewReasons.join(",")})` : ""}`,
    `- Live execution: ${summary.liveStage}${summary.auditDecision ? `; audit=${summary.auditDecision}` : ""}${summary.liveReasons.length ? ` (${summary.liveReasons.join(",")})` : ""}`,
  ];
}

function stableRouteCandidates(scores = []) {
  return scores
    .filter((score) => score?.srcAsset?.family === "stablecoin" || score?.dstAsset?.family === "stablecoin")
    .sort(
      (left, right) =>
        (right.executableNetEdgeUsd ?? right.netEdgeUsd ?? Number.NEGATIVE_INFINITY) -
          (left.executableNetEdgeUsd ?? left.netEdgeUsd ?? Number.NEGATIVE_INFINITY) ||
        String(left.routeKey).localeCompare(String(right.routeKey)),
    );
}

function strategyLines(scores = [], shadowObservations = [], dexQuotes = [], routes = [], routesObservedAt = null, quotes = []) {
  const bestStable = stableRouteCandidates(scores)[0] || null;
  const crossAsset = buildCrossAssetArbitrageSummary({ scores });
  const dexEnvironment = buildDexEnvironmentSummary({ dexQuotes });
  const dexRouteFocus = buildDexRouteFocusSummary({ routes, quotes, scoreSnapshot: { scores }, dexQuotes });
  const dexGateway = buildDexGatewayArbitrageSummary({ scoreSnapshot: { scores }, dexQuotes });
  const dexRouteUniverse = buildDexRouteUniverseSummary({ routes, observedAt: routesObservedAt });
  const edgeViability = buildEdgeViabilitySummary({ scoreSnapshot: { scores }, dexQuotes });
  const edgeViabilityVerdict = buildEdgeViabilityVerdict({ edgeViability, dexRouteFocus });
  const edgeResearch = buildEdgeResearchSummary({ scoreSnapshot: { scores }, shadowObservations });
  const noEdgePersistence = buildNoEdgePersistenceSummary({ scoreSnapshot: { scores }, dexQuotes });
  return [
    "- Strategy note: BTC-family transfer by itself is usually loss-making after Gateway fee, gas, and slippage.",
    "- Strategy note: the actionable target is a local executable BTC/stable dislocation that beats total movement cost.",
    "- Strategy note: BTC accumulation from a long-term bullish view is directional inventory exposure, not arbitrage profit, so it must not unlock canary or live execution by itself.",
    `- Strong-edge research: definite=${edgeResearch.definiteEdgeCandidateCount} multiLevel=${edgeResearch.multiLevelCandidateCount} missingDecay=${edgeResearch.missingDecayCoverageCount + edgeResearch.missingDecaySurvivalCount} singleLevel=${edgeResearch.singleLevelOnlyCount} noEdge=${edgeResearch.noEdgeCount} outliers=${edgeResearch.outlierCount}`,
    `- DEX route universe: btcFamily=${dexRouteUniverse.btcFamilyRouteCount} fullyMeasurable=${dexRouteUniverse.fullyMeasurableRouteCount} singleGap=${dexRouteUniverse.singleProviderGapCount} doubleGap=${dexRouteUniverse.doubleProviderGapCount}`,
    `- DEX focus shortlist: loopObservable=${dexRouteFocus.loopObservableCount} partial=${dexRouteFocus.partialLoopMeasurementCount} missingGatewayQuote=${dexRouteFocus.missingGatewayQuoteCount}`,
    `- Edge viability: measured=${edgeViability.measuredLoopCount} positive=${edgeViability.positiveMeasuredCount} policyReady=${edgeViability.policyReadyCount} medianGap=${money(edgeViability.medianGapToPolicyUsd)}`,
    `- Edge verdict: ${edgeViabilityVerdict.label}${edgeViabilityVerdict.detail ? ` (${edgeViabilityVerdict.detail})` : ""}`,
    `- No-edge persistence: durable=${noEdgePersistence.durableNoEdgeRouteCount} belowPolicy=${noEdgePersistence.belowPolicyRouteCount} nearPolicy=${noEdgePersistence.nearPolicyRouteCount} positiveBelow=${noEdgePersistence.positiveButBelowPolicyRouteCount}`,
    dexRouteUniverse.topGapChain
      ? `- Largest DEX coverage gap chain: \`${dexRouteUniverse.topGapChain.chain}\` routeCount=${dexRouteUniverse.topGapChain.routeCount}`
      : "- Largest DEX coverage gap chain: none observed",
    dexRouteFocus.bestRoute
      ? `- Best DEX focus route now: \`${dexRouteFocus.bestRoute.routeKey}\` class=\`${dexRouteFocus.bestRoute.classification}\` gatewayQuotes=${dexRouteFocus.bestRoute.gatewayQuoteCount} entryQuotes=${dexRouteFocus.bestRoute.entryQuoteCount} exitQuotes=${dexRouteFocus.bestRoute.exitQuoteCount} bestExec=${money(dexRouteFocus.bestRoute.bestExecutableNetEdgeUsd)}`
      : "- Best DEX focus route now: none observed",
    `- DEX environment drift: monitored=${dexEnvironment.monitoredRouteCount} staleLegs=${dexEnvironment.staleLegCount} unstableLegs=${dexEnvironment.unstableLegCount} thinLiquidityLegs=${dexEnvironment.thinLiquidityLegCount} singleSampleLegs=${dexEnvironment.singleSampleLegCount}`,
    dexEnvironment.topRiskRoute
      ? `- Top DEX environment risk: \`${dexEnvironment.topRiskRoute.routeKey}\` amount=\`${dexEnvironment.topRiskRoute.amount}\` class=\`${dexEnvironment.topRiskRoute.classification}\` staleLegs=${dexEnvironment.topRiskRoute.staleLegCount} unstableLegs=${dexEnvironment.topRiskRoute.unstableLegCount} thinLiquidityLegs=${dexEnvironment.topRiskRoute.thinLiquidityLegCount} singleSampleLegs=${dexEnvironment.topRiskRoute.singleSampleLegCount}`
      : "- Top DEX environment risk: none observed",
    edgeResearch.bestCandidate
      ? `- Best research route now: \`${edgeResearch.bestCandidate.routeKey}\` class=\`${edgeResearch.bestCandidate.classification}\` profitableLevels=${edgeResearch.bestCandidate.profitableLevels}/${edgeResearch.bestCandidate.amountLevels} bestNet=${money(edgeResearch.bestCandidate.bestNetEdgeUsd)}`
      : "- Best research route now: none observed",
    `- Measured DEX+Gateway coverage: bothDexSupported=${dexGateway.bothDexSupportedRouteCount} executable=${dexGateway.executableLoopCount} measuredNet=${dexGateway.measuredNetLoopCount} exact=${dexGateway.exactAmountMatchCount} profitable=${dexGateway.profitableExactCount}`,
    edgeViability.closestLoop
      ? `- Closest route to policy gate: \`${edgeViability.closestLoop.routeKey}\` amount=\`${edgeViability.closestLoop.amount}\` net=${money(edgeViability.closestLoop.measuredLoopNetUsd)} gapToPolicy=${money(edgeViability.closestLoop.gapToPolicyUsd)} target=${money(edgeViability.closestLoop.requiredNetProfitUsd)}`
      : "- Closest route to policy gate: none observed",
    noEdgePersistence.bestRoute
      ? `- Best persistence route now: \`${noEdgePersistence.bestRoute.routeKey}\` class=\`${noEdgePersistence.bestRoute.classification}\` measuredLevels=${noEdgePersistence.bestRoute.measuredLevelCount} minGap=${money(noEdgePersistence.bestRoute.minGapToPolicyUsd)} bestNet=${money(noEdgePersistence.bestRoute.bestMeasuredLoopNetUsd)}`
      : "- Best persistence route now: none observed",
    dexGateway.bestLoop
      ? `- Best measured DEX+Gateway loop: \`${dexGateway.bestLoop.routeKey}\` netEdge=${money(dexGateway.bestLoop.measuredLoopNetUsd)} amountGap=${((dexGateway.bestLoop.amountGapPct || 0) * 100).toFixed(2)}%`
      : dexGateway.closestLoop
        ? `- Closest measured DEX+Gateway loop: \`${dexGateway.closestLoop.routeKey}\` netEdge=${money(dexGateway.closestLoop.measuredLoopNetUsd)} amountGap=${((dexGateway.closestLoop.amountGapPct || 0) * 100).toFixed(2)}% blockers=${dexGateway.closestLoop.blockers.join(",") || "none"}`
        : "- Best measured DEX+Gateway loop: none observed",
    bestStable
      ? `- Best stablecoin-related route now: \`${bestStable.routeKey}\` amount=\`${bestStable.amount}\` readiness=\`${bestStable.tradeReadiness}\` netEdge=${money(bestStable.executableNetEdgeUsd ?? bestStable.netEdgeUsd)}`
      : "- Best stablecoin-related route now: none observed",
    crossAsset.bestLoop
      ? `- Best closed stable->BTC->stable loop: \`${crossAsset.bestLoop.entryRouteKey}\` + \`${crossAsset.bestLoop.exitRouteKey}\` netEdge=${money(crossAsset.bestLoop.loopNetEdgeUsd)}`
      : "- Best closed stable->BTC->stable loop: none matched yet",
    crossAsset.closestLoop && !crossAsset.bestLoop
      ? `- Closest loop blocker: amount gap ${(crossAsset.closestLoop.amountGapPct * 100).toFixed(2)}% on \`${crossAsset.closestLoop.entryRouteKey}\` + \`${crossAsset.closestLoop.exitRouteKey}\``
      : null,
  ];
}

function profitabilityLines(summary) {
  if (!summary) return ["- Profitability summary unavailable"];
  const reviewPlan = summary.canarySelectionGap?.reviewPlan || null;
  const reviewCommands = reviewPlan
    ? [
        reviewPlan.actionCodes.includes("check_wallet_readiness")
          ? `npm run check:estimator-wallet -- --route-key="${reviewPlan.routeKey}" --amount="${reviewPlan.amount}"`
          : null,
        reviewPlan.actionCodes.includes("refresh_exact_gas")
          ? `npm run estimate:gateway-gas -- --route-key="${reviewPlan.routeKey}" --amount="${reviewPlan.amount}"`
          : null,
        reviewPlan.actionCodes.includes("refresh_dex_quote")
          ? `npm run quote:dex -- --route-key="${reviewPlan.routeKey}" --amount="${reviewPlan.amount}"`
          : null,
        reviewPlan.actionCodes.includes("refresh_market_snapshot")
          ? "npm run price:snapshot"
          : null,
        reviewPlan.actionCodes.includes("rerun_route_scoring")
          ? `npm run score:gateway -- --write --route-key="${reviewPlan.routeKey}" --amount="${reviewPlan.amount}"`
          : null,
        reviewPlan.actionCodes.includes("refresh_public_status")
          ? "npm run status:dashboard"
          : null,
      ].filter(Boolean)
    : [];
  return [
    `- Tested closed loops: ${summary.measuredClosedLoopCount}`,
    `- Profitable closed loops: ${summary.profitableClosedLoopCount}`,
    `- Loop-observable routes: ${summary.loopObservableRouteCount}`,
    `- Missing focus Gateway quotes: ${summary.missingGatewayQuoteCount}`,
    `- Profit verdict: ${summary.verdictLabel || "unknown"}${summary.verdictDetail ? ` (${summary.verdictDetail})` : ""}`,
    summary.canaryTradeReadiness
      ? `- Current canary route: ${summary.canaryTradeReadiness}${Number.isFinite(summary.canaryNetEdgeUsd) ? ` net=${money(summary.canaryNetEdgeUsd)}` : ""}`
      : "- Current canary route: unavailable",
    summary.closestPolicyRoute
      ? `- Closest route to policy: \`${summary.closestPolicyRoute.routeKey}\` amount=\`${summary.closestPolicyRoute.amount}\` net=${money(summary.closestPolicyRoute.netUsd)} gap=${money(summary.closestPolicyRoute.gapToPolicyUsd)} target=${money(summary.closestPolicyRoute.targetUsd)}`
      : "- Closest route to policy: none observed",
    summary.bestStablecoinRoute
      ? `- Best stablecoin route tested: \`${summary.bestStablecoinRoute.routeKey}\` amount=\`${summary.bestStablecoinRoute.amount}\` readiness=\`${summary.bestStablecoinRoute.tradeReadiness}\` net=${money(summary.bestStablecoinRoute.netUsd)}`
      : "- Best stablecoin route tested: none observed",
    summary.canarySelectionGap
      ? `- Measured leader under review: \`${summary.canarySelectionGap.measuredLeader.routeKey}\` amount=\`${summary.canarySelectionGap.measuredLeader.amount}\` measured=${money(summary.canarySelectionGap.measuredLeader.measuredNetUsd)} readiness=\`${summary.canarySelectionGap.measuredLeader.tradeReadiness || "unknown"}\``
      : null,
    summary.canarySelectionGap
      ? `- Why it is not the canary: ${summary.canarySelectionGap.reasonLabels.join("; ")}${summary.canarySelectionGap.blockerLabels.length ? ` | blockers: ${summary.canarySelectionGap.blockerLabels.join(", ")}` : ""}`
      : null,
    reviewPlan?.actionLabels?.length
      ? `- Revalidation order for measured leader: ${reviewPlan.actionLabels.join(" -> ")}`
      : null,
    reviewCommands.length
      ? `- Revalidation commands: ${reviewCommands.join(" && ")}`
      : null,
    summary.canarySelectionGap?.hypothesisGuard
      ? `- Hypothesis guard: ${summary.canarySelectionGap.hypothesisGuard}`
      : null,
    `- Durable no-edge routes: ${summary.durableNoEdgeRouteCount}`,
  ];
}

async function main() {
  const now = new Date().toISOString();
  const resolved = await resolveOperationalAddress({ dataDir: config.dataDir });
  const state = await loadCanaryState({
    address: resolved.address,
    dataDir: config.dataDir,
  });
  const { routePlan, fundingPlan, nextStep: next, dashboardStatus } = state;
  const canaryInputs = buildCanaryInputSummary(state);
  const btcWatchlist = dashboardStatus?.gateway?.btcWatchlist || buildBtcWatchlistFallbackSummary(state?.routesRecords?.at(-1)?.routes || []);
  const best = next.route || routePlan.topCandidates?.[0] || null;
  const checklist = buildCanaryStageChecklist({
    route: best,
    nextStep: next,
    inputSummary: canaryInputs,
    shadowCycle: dashboardStatus?.shadowCycle || null,
    advanceCanary: dashboardStatus?.canaryAdvance || null,
  });
  const executionStage = buildExecutionStageSummary({
    nextStep: next,
    dashboardStatus,
  });
  const nextReadinessCheck = dashboardStatus?.shadowCycle?.canary?.nextReadinessCheck || null;
  const nextReadinessRefresh = dashboardStatus?.shadowCycle?.canary?.nextReadinessRefresh || null;
  const gasRefresh = planGasRefresh(state);
  const canaryInputRefresh = planCanaryInputRefresh(state);
  const dexRefresh = planDexPriceRefresh(state);
  const blockedScoreRefresh = planBlockedScoreRefresh(state);
  blockedScoreRefresh.srcChain = next.route?.srcChain || null;
  blockedScoreRefresh.dstChain = next.route?.dstChain || null;
  const decayRefresh = planQuoteDecayRefresh(state);
  const gatewayCoverageRefresh = planDexGatewayCoverageRefresh(state);
  const profitabilityDexRouteFocus = buildDexRouteFocusSummary({
    routes: state?.routesRecords?.at(-1)?.routes || [],
    quotes: state?.quotes || [],
    scoreSnapshot: state?.scoreSnapshot || null,
    dexQuotes: state?.dexQuotes || [],
  });
  const profitabilityDexGateway = buildDexGatewayArbitrageSummary({
    scoreSnapshot: state?.scoreSnapshot || null,
    dexQuotes: state?.dexQuotes || [],
  });
  const profitabilityEdgeViability = buildEdgeViabilitySummary({
    scoreSnapshot: state?.scoreSnapshot || null,
    dexQuotes: state?.dexQuotes || [],
  });
  const profitabilityNoEdgePersistence = buildNoEdgePersistenceSummary({
    scoreSnapshot: state?.scoreSnapshot || null,
    dexQuotes: state?.dexQuotes || [],
  });
  const profitabilityEdgeVerdict = buildEdgeViabilityVerdict({
    edgeViability: profitabilityEdgeViability,
    dexRouteFocus: profitabilityDexRouteFocus,
  });
  const profitabilitySummary = buildProfitabilitySummary({
    scoreSnapshot: state?.scoreSnapshot || null,
    dexRouteFocus: profitabilityDexRouteFocus,
    dexGatewayArbitrage: profitabilityDexGateway,
    edgeViability: { ...profitabilityEdgeViability, verdict: profitabilityEdgeVerdict },
    noEdgePersistence: profitabilityNoEdgePersistence,
    canaryInputs,
    routePlan,
  });

  const doc = [
    "# Current Status",
    "",
    `Updated: ${now}`,
    "",
    "## Start Here",
    "",
    "- Read this file first in a shallow session.",
    "- Main command: `npm run advance:canary`",
    "- Safe status refresh: `npm run audit:overfit && npm run score:gateway -- --write && npm run status:dashboard`",
    "",
    "## Current Phase",
    "",
    `- Address: \`${resolved.address}\``,
    "- Phase: canary-prep gating before exact gas",
    `- Decision: \`${next.decision}\``,
    `- Headline: ${next.headline}`,
    `- Live trading: \`${dashboardStatus?.overall?.liveTrading || "BLOCKED"}\``,
    `- Shadow trading: \`${dashboardStatus?.overall?.shadowTrading || "ALLOWED"}\``,
    "",
    "## Progress Snapshot",
    "",
    ...checklistLines(checklist),
    ...executionStageLines(executionStage),
    "",
    "## Best Route Right Now",
    "",
    best
      ? `- Route: \`${best.label}\``
      : "- Route: none",
    best
      ? `- Route key: \`${best.routeKey}\` amount=\`${best.amount}\``
      : "- Route key: none",
    best
      ? `- txReady=${best.txReady} exactGasDone=${best.exactGasDone} viableForPrep=${best.viableForPrep}`
      : "- txReady=false exactGasDone=false viableForPrep=false",
    best
      ? `- Input value: ${money(best.inputUsd)}`
      : "- Input value: n/a",
    best
      ? `- Prep funding estimate: ${money(best.prepFundingUsd)}`
      : "- Prep funding estimate: n/a",
    best
      ? `- Net edge now: ${money(best.netEdgeUsd)}`
      : "- Net edge now: n/a",
    tradeReadinessLine(best),
    nextReadinessCheck
      ? `- Next readiness check: \`${nextReadinessCheck.label}\` amount=\`${nextReadinessCheck.amount}\``
      : "- Next readiness check: none",
    readinessRefreshLine(nextReadinessRefresh),
    nextFocusLine(best),
    "",
    "## Required Actions Before Exact Gas",
    "",
    ...linesForActions(next.actions),
    "",
    "## Objective Verification",
    "",
    "- This file does not execute validation by itself.",
    "- Rerun `npm run check` before acting on code changes.",
    "- Rerun `npm test` before acting on behavior assumptions.",
    `- Candidate routes observed: ${routePlan.candidateCount}`,
    `- txReady routes: ${routePlan.txReadyCount}`,
    `- viable prep routes: ${routePlan.viableCount}`,
    "",
    "## Shadow Roster",
    "",
    ...shadowRosterLines(routePlan),
    "",
    "## Profitability Summary",
    "",
    ...overfitAuditLines(dashboardStatus?.audit),
    "",
    ...profitabilityLines(profitabilitySummary),
    "",
    ...strategyLines(
      state?.scoreSnapshot?.scores || [],
      state?.shadowObservations || [],
      state?.dexQuotes || [],
      state?.routesRecords?.at(-1)?.routes || [],
      state?.routesRecords?.at(-1)?.observedAt || null,
      state?.quotes || [],
    ),
    quoteDecayLine(dashboardStatus?.audit),
    priceCoverageLine(dashboardStatus?.market),
    ...quoteableCoverageLine(dashboardStatus?.market),
    ...btcWatchlistLines(btcWatchlist),
    lastAdvanceLine(dashboardStatus?.canaryAdvance),
    ...canaryInputsLines(canaryInputs),
    canaryInputRefreshLine(canaryInputRefresh),
    gasRefreshLine(gasRefresh),
    dexRefreshLine(dexRefresh, state),
    gatewayCoverageLine(gatewayCoverageRefresh),
    blockedScoreLine(blockedScoreRefresh),
    quoteDecayRefreshLine(decayRefresh),
    `- estimator wallet checked routes: ${fundingPlan.routeCount}`,
    `- estimator skipped routes: ${fundingPlan.skippedRouteCount}`,
    `- skipped reasons: ${fundingPlan.failureReasons.map((item) => `${item.reason}:${item.count}`).join(",") || "none"}`,
    "",
    "## Next Command Order After Funding",
    "",
    "1. `npm run check:estimator-wallet -- --route-key=\"<routeKey>\" --amount=\"<amount>\"`",
    `2. \`npm run estimate:gateway-gas -- --from="${resolved.address}" --route-key="<routeKey>" --amount="<amount>"\``,
    "3. `npm run score:gateway -- --write`",
    "4. `npm run status:dashboard`",
    "5. `npm run advance:canary`",
    "",
    "## Important Files",
    "",
    "- `src/cli/advance-canary.mjs`",
    "- `src/cli/plan-canary-next-step.mjs`",
    "- `src/cli/plan-canary-routes.mjs`",
    "- `src/cli/plan-estimator-wallet.mjs`",
    "- `src/estimator/canary-next-step.mjs`",
    "- `src/estimator/canary-route-plan.mjs`",
    "- `src/estimator/funding-plan.mjs`",
    "- `docs/current-status.md`",
    "",
    "## Backup Note",
    "",
    "- `.env` and `data/` stay out of git.",
    "- This repo is safe to back up publicly only if you are comfortable exposing source; operational secrets are ignored by git.",
    "- Prefer a private GitHub repo for backup.",
    "",
  ].filter((line) => line != null).join("\n");

  const outputPath = join(process.cwd(), OUTPUT_PATH);
  const result = await writeTextIfChanged(outputPath, `${doc}\n`, {
    normalize: normalizeCurrentStatusDoc,
  });
  console.log(`${result.changed ? "wrote" : "unchanged"}=${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
