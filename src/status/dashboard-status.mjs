import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isBtcFamilyRoute, routeAsset, tokenAsset } from "../assets/tokens.mjs";
import { buildOverfitAudit } from "../audit/overfit.mjs";
import { compareAnnouncedGatewayChains } from "../chains/gateway-announced.mjs";
import { latestBy } from "../lib/jsonl-read.mjs";

const STATUS_SCHEMA_VERSION = 1;
const RISK_BUDGET_USD = 300;
const GATEWAY_NODE = "bob_gateway";

function latest(items) {
  return items.at(-1) || null;
}

function minutesBetween(older, newer) {
  if (!older) return null;
  return (new Date(newer).getTime() - new Date(older).getTime()) / 60_000;
}

function countRecent(items, now, hours) {
  const cutoff = new Date(now).getTime() - hours * 3_600_000;
  return items.filter((item) => item.observedAt && new Date(item.observedAt).getTime() >= cutoff).length;
}

function routeChains(routes) {
  return [...new Set(routes.flatMap((route) => [route.srcChain, route.dstChain]))].sort();
}

function routeKey(route) {
  return `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;
}

function chainPairKey(route) {
  return `${route.srcChain}->${route.dstChain}`;
}

function directionForRoute(route) {
  if (route.srcChain === "bitcoin") return "btc_out";
  if (route.dstChain === "bitcoin") return "btc_in";
  if (route.srcChain === "bob") return "bob_out";
  if (route.dstChain === "bob") return "bob_in";
  return "chain_to_chain";
}

function visualPathForRoute(route) {
  return [route.srcChain, GATEWAY_NODE, route.dstChain];
}

function visualSegmentsForRoute(route) {
  const src = tokenAsset(route.srcChain, route.srcToken);
  const dst = tokenAsset(route.dstChain, route.dstToken);
  return [
    { from: route.srcChain, to: GATEWAY_NODE, asset: src },
    { from: GATEWAY_NODE, to: route.dstChain, asset: dst },
  ];
}

function buildFlowRoutes(routes) {
  const byPair = new Map();

  for (const route of routes) {
    const pair = chainPairKey(route);
    const path = visualPathForRoute(route);
    const key = `${pair}|${path.join(">")}`;
    if (!byPair.has(key)) {
      byPair.set(key, {
        pair,
        srcChain: route.srcChain,
        dstChain: route.dstChain,
        direction: directionForRoute(route),
        path,
        routeCount: 0,
        routeKeys: [],
        btcFamilyRoutes: 0,
        assets: new Map(),
      });
    }

    const item = byPair.get(key);
    item.routeCount += 1;
    item.routeKeys.push(routeKey(route));
    if (isBtcFamilyRoute(route)) item.btcFamilyRoutes += 1;
    const asset = routeAsset(route);
    const assetKey = `${asset.src.ticker}->${asset.dst.ticker}`;
    item.assets.set(assetKey, {
      ticker: asset.ticker,
      family: asset.family,
      icon: asset.icon,
      src: asset.src,
      dst: asset.dst,
      count: (item.assets.get(assetKey)?.count || 0) + 1,
    });
  }

  const directionOrder = {
    btc_out: 0,
    btc_in: 1,
    bob_out: 2,
    bob_in: 3,
    chain_to_chain: 4,
  };

  return [...byPair.values()]
    .map((item) => ({
      ...item,
      assets: [...item.assets.values()].sort((left, right) => right.count - left.count || left.ticker.localeCompare(right.ticker)),
      routeKeys: item.routeKeys.sort().slice(0, 8),
    }))
    .sort(
      (left, right) =>
        directionOrder[left.direction] - directionOrder[right.direction] ||
        right.routeCount - left.routeCount ||
        left.pair.localeCompare(right.pair),
    );
}

function buildRecentFlowEvents(quotes) {
  return quotes
    .filter((quote) => quote.route)
    .slice(-40)
    .map((quote) => ({
      observedAt: quote.observedAt,
      srcChain: quote.route.srcChain,
      dstChain: quote.route.dstChain,
      direction: directionForRoute(quote.route),
      path: visualPathForRoute(quote.route),
      segments: visualSegmentsForRoute(quote.route),
      asset: routeAsset(quote.route),
      quoteType: quote.quoteType,
      amount: quote.amount,
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
      feeRatio: Number.isFinite(quote.feeRatio) ? quote.feeRatio : null,
      latencyMs: quote.latencyMs || null,
      estimatedTimeInSecs: quote.estimatedTimeInSecs || null,
    }))
    .sort((left, right) => new Date(left.observedAt) - new Date(right.observedAt));
}

function buildAssetCoverage(routes, quotes, failures) {
  const supported = new Map();
  const sampled = new Map();
  const failed = new Map();

  for (const route of routes || []) {
    const asset = routeAsset(route);
    const key = asset.ticker;
    const existing = supported.get(key);
    supported.set(key, {
      ticker: key,
      family: asset.family,
      icon: asset.icon,
      routeCount: (existing?.routeCount || 0) + 1,
    });
  }

  for (const quote of quotes || []) {
    if (!quote.route) continue;
    const asset = routeAsset(quote.route);
    const key = asset.ticker;
    const existing = sampled.get(key);
    sampled.set(key, {
      ticker: key,
      family: asset.family,
      icon: asset.icon,
      quoteCount: (existing?.quoteCount || 0) + 1,
      lastObservedAt: quote.observedAt,
    });
  }

  for (const failure of failures || []) {
    if (!failure.route) continue;
    const asset = routeAsset(failure.route);
    const key = asset.ticker;
    const existing = failed.get(key);
    failed.set(key, {
      ticker: key,
      failureCount: (existing?.failureCount || 0) + 1,
      lastObservedAt: failure.observedAt,
    });
  }

  const supportedAssets = [...supported.values()].sort((left, right) => right.routeCount - left.routeCount || left.ticker.localeCompare(right.ticker));
  const sampledAssets = [...sampled.values()].sort((left, right) => right.quoteCount - left.quoteCount || left.ticker.localeCompare(right.ticker));
  const failedAssets = [...failed.values()].sort((left, right) => right.failureCount - left.failureCount || left.ticker.localeCompare(right.ticker));
  const unsampledAssets = supportedAssets.filter((asset) => !sampled.has(asset.ticker));

  return {
    supportedAssetCount: supportedAssets.length,
    sampledAssetCount: sampledAssets.length,
    unsampledAssetCount: unsampledAssets.length,
    supportedAssets,
    sampledAssets,
    failedAssets,
    unsampledAssets,
  };
}

function gatewaySummary({ latestRoutesRecord, latestUpdateSnapshot, latestUpdateAlert, updateAlerts, quotes, failures, now }) {
  const snapshot = latestUpdateSnapshot?.snapshot || null;
  const routes = latestRoutesRecord?.routes || [];
  const chains = snapshot?.chains || routeChains(routes);
  const routeCount = snapshot?.routeCount || latestRoutesRecord?.summary?.totalRoutes || routes.length || 0;
  const probeOk = latestUpdateSnapshot?.probes?.filter((probe) => probe.ok).length || 0;
  const probeTotal = latestUpdateSnapshot?.probes?.length || 0;
  const probeFailures = latestUpdateSnapshot?.probeFailures || [];
  const flowRoutes = buildFlowRoutes(routes);

  return {
    observedAt: latestUpdateSnapshot?.observedAt || latestRoutesRecord?.observedAt || null,
    ageMinutes: minutesBetween(latestUpdateSnapshot?.observedAt || latestRoutesRecord?.observedAt, now),
    routeCount,
    chainCount: chains.length,
    chains,
    announcedChainCoverage: compareAnnouncedGatewayChains(chains),
    bobTouchingRouteCount: snapshot?.bobTouchingRouteKeys?.length || null,
    updateDetected: Boolean(latestUpdateSnapshot?.updateDetected),
    changeReasons: latestUpdateSnapshot?.changeReasons || [],
    routeHash: snapshot?.routeHash || null,
    chainPairs: latestRoutesRecord?.summary?.chainPairs || snapshot?.summary?.chainPairs || [],
    flowRoutes,
    recentFlowEvents: buildRecentFlowEvents(quotes || []),
    assetCoverage: buildAssetCoverage(routes, quotes || [], failures || []),
    schemaHash: latestUpdateSnapshot?.schemaHash || null,
    probeHealthHash: latestUpdateSnapshot?.probeHealthHash || null,
    probeOk,
    probeTotal,
    probeFailures: probeFailures.map((failure) => ({
      routeKey: failure.routeKey,
      errorStatus: failure.errorStatus || null,
      errorCode: failure.errorCode || null,
      errorName: failure.errorName || null,
    })),
    recentAlertCount24h: countRecent(updateAlerts, now, 24),
    lastAlert: latestUpdateAlert
      ? {
          observedAt: latestUpdateAlert.observedAt,
          changeReasons: latestUpdateAlert.changeReasons || [],
          routeCount: latestUpdateAlert.routeCount || null,
          routeDiff: latestUpdateAlert.routeDiff || null,
          schemaDiff: latestUpdateAlert.schemaDiff || null,
          probeHealthDiff: latestUpdateAlert.probeHealthDiff || null,
          probeFailures: latestUpdateAlert.probeFailures || [],
        }
      : null,
  };
}

function gasSummary({ gasSnapshots, gasFailures, gatewayChains, now }) {
  const latestGasByChain = latestBy(gasSnapshots, (snapshot) => snapshot.chain);
  const expectedGatewayGasChains = gatewayChains.filter((chain) => chain !== "bitcoin").sort();
  const missingGatewayGasChains = expectedGatewayGasChains.filter((chain) => !latestGasByChain.has(chain));
  const chains = [...latestGasByChain.entries()]
    .map(([chain, snapshot]) => ({
      chain,
      observedAt: snapshot.observedAt,
      ageMinutes: minutesBetween(snapshot.observedAt, now),
      gasPriceWei: snapshot.gasPriceWei,
      blockNumber: snapshot.blockNumber,
      latencyMs: snapshot.latencyMs,
      fallbackGasUnits: snapshot.fallbackGasUnits,
      fallbackTxUsd: snapshot.fallbackTxUsd,
      nativeUsd: snapshot.nativeUsd,
    }))
    .sort((left, right) => left.chain.localeCompare(right.chain));

  return {
    latestChainCount: chains.length,
    expectedGatewayGasChains,
    missingGatewayGasChains,
    missingGatewayGasChainCount: missingGatewayGasChains.length,
    staleChainCount30m: chains.filter((item) => item.ageMinutes === null || item.ageMinutes > 30).length,
    recentFailureCount24h: countRecent(gasFailures, now, 24),
    chains,
    lastFailure: latest(gasFailures)
      ? {
          observedAt: latest(gasFailures).observedAt,
          chain: latest(gasFailures).chain,
          error: latest(gasFailures).error,
        }
      : null,
  };
}

function auditSummary(audit) {
  return {
    decision: audit.decision,
    shadow: audit.shadow,
    firstObservedAt: audit.firstObservedAt,
    lastObservedAt: audit.lastObservedAt,
    shadowHours: audit.shadowHours,
    quotes: audit.quotes,
    activeQuotes: audit.activeQuotes,
    failures: audit.failures,
    cloudflareFailures: audit.cloudflareFailures,
    sampledRoutes: audit.sampledRoutes,
    totalGatewayRoutes: audit.totalGatewayRoutes,
    sampledBobNeighborRoutes: audit.sampledBobNeighborRoutes,
    bobNeighborRoutes: audit.bobNeighborRoutes,
    checks: audit.checks,
    warnings: audit.warnings,
    blockers: audit.checks.filter((check) => !check.ok).map((check) => check.label),
    warningLabels: audit.warnings.filter((warning) => !warning.ok).map((warning) => warning.label),
    topSampledRoutes: audit.topSampledRoutes,
  };
}

function opportunitySummary(scoreSnapshot) {
  const scores = scoreSnapshot?.scores || [];
  const candidateCount = scoreSnapshot?.summary?.shadowCandidates ?? scores.filter((score) => score.tradeReadiness === "shadow_candidate_review_only").length;
  const rejectedNoEdge = scores.filter((score) => score.tradeReadiness === "reject_no_net_edge").length;
  const insufficientData = scoreSnapshot?.summary?.insufficientData ?? scores.filter((score) => score.tradeReadiness === "insufficient_data").length;
  const dataGaps = new Map();
  for (const score of scores) {
    for (const gap of score.dataGaps || []) {
      dataGaps.set(gap, (dataGaps.get(gap) || 0) + 1);
    }
  }
  const best = [...scores]
    .filter((score) => Number.isFinite(score.netEdgeUsd))
    .sort((left, right) => right.netEdgeUsd - left.netEdgeUsd)
    .at(0);

  return {
    generatedAt: scoreSnapshot?.generatedAt || null,
    scoredQuotes: scoreSnapshot?.scoredQuotes || scores.length,
    candidateCount,
    dexBacked: scoreSnapshot?.summary?.dexBacked ?? scores.filter((score) => score.dex).length,
    rejectedNoEdge,
    highFailureRate: scoreSnapshot?.summary?.highFailureRate ?? scores.filter((score) => (score.routeStats?.failureRate ?? 0) > 0.1).length,
    insufficientData,
    bestNetEdgeUsd: best?.netEdgeUsd ?? null,
    bestRoute: best
      ? {
          srcChain: best.srcChain,
          dstChain: best.dstChain,
          srcTicker: best.srcAsset?.ticker || null,
          dstTicker: best.dstAsset?.ticker || null,
          readiness: best.tradeReadiness,
          dataGaps: best.dataGaps || [],
        }
      : null,
    dataGaps: [...dataGaps.entries()]
      .map(([gap, count]) => ({ gap, count }))
      .sort((left, right) => right.count - left.count || left.gap.localeCompare(right.gap)),
  };
}

function dexSummary({ dexQuotes = [], dexFailures = [], now }) {
  const latestQuote = latest(dexQuotes);
  const recentQuotes24h = countRecent(dexQuotes, now, 24);
  const recentFailures24h = countRecent(dexFailures, now, 24);
  const quotedChains = [...new Set(dexQuotes.map((quote) => quote.chain).filter(Boolean))].sort();
  const skippedReasons = new Map();
  for (const failure of dexFailures) {
    const reason = failure.reason || "unknown";
    skippedReasons.set(reason, (skippedReasons.get(reason) || 0) + 1);
  }

  return {
    provider: dexQuotes.at(-1)?.provider || dexFailures.at(-1)?.provider || "odos",
    quoteCount: dexQuotes.length,
    failureCount: dexFailures.length,
    recentQuotes24h,
    recentFailures24h,
    quotedChains,
    latestQuote: latestQuote
      ? {
          observedAt: latestQuote.observedAt,
          chain: latestQuote.chain,
          inputValueUsd: latestQuote.inputValueUsd,
          outputValueUsd: latestQuote.outputValueUsd,
          gasEstimateValueUsd: latestQuote.gasEstimateValueUsd,
          priceImpactPct: latestQuote.priceImpactPct,
        }
      : null,
    skippedReasons: [...skippedReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
}

function bitcoinFeeSummary({ bitcoinFeeSnapshots = [], now }) {
  const snapshot = latest(bitcoinFeeSnapshots);
  return {
    latest: snapshot
      ? {
          observedAt: snapshot.observedAt,
          ageMinutes: minutesBetween(snapshot.observedAt, now),
          source: snapshot.source || null,
          feeRateSatVb: Number.isFinite(snapshot.selectedFeeRateSatVb) ? snapshot.selectedFeeRateSatVb : null,
          vbytes: Number.isFinite(snapshot.vbytes) ? snapshot.vbytes : null,
          estimatedFeeSats: Number.isFinite(snapshot.estimatedFeeSats) ? snapshot.estimatedFeeSats : null,
          estimatedFeeUsd: Number.isFinite(snapshot.estimatedFeeUsd) ? snapshot.estimatedFeeUsd : null,
          btcUsd: Number.isFinite(snapshot.btcUsd) ? snapshot.btcUsd : null,
          model: snapshot.model || null,
        }
      : null,
    snapshotCount: bitcoinFeeSnapshots.length,
  };
}

function executionGasSummary({ gatewayGasEstimates = [], gatewayGasEstimateFailures = [], now }) {
  const latestEstimate = latest(gatewayGasEstimates);
  const reasons = new Map();
  for (const failure of gatewayGasEstimateFailures) {
    const reason = failure.reason || "unknown";
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  return {
    estimateCount: gatewayGasEstimates.length,
    failureCount: gatewayGasEstimateFailures.length,
    recentEstimateCount24h: countRecent(gatewayGasEstimates, now, 24),
    recentFailureCount24h: countRecent(gatewayGasEstimateFailures, now, 24),
    latestEstimate: latestEstimate
      ? {
          observedAt: latestEstimate.observedAt,
          ageMinutes: minutesBetween(latestEstimate.observedAt, now),
          srcChain: latestEstimate.srcChain,
          dstChain: latestEstimate.dstChain,
          gasUnits: latestEstimate.gasUnits,
          estimatedGasUsd: latestEstimate.estimatedGasUsd,
          source: latestEstimate.source,
        }
      : null,
    failureReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
}

function estimatorWalletSummary({ estimatorWalletReadiness = [], estimatorWalletReadinessFailures = [], now }) {
  const latestByRoute = latestBy(estimatorWalletReadiness, (item) => `${item.routeKey}|${item.amount}`);
  const latestChecks = [...latestByRoute.values()];
  const latestCheck = latest(latestChecks);
  const readinessFailures = new Map();
  for (const failure of estimatorWalletReadinessFailures) {
    const reason = failure.reason || "unknown";
    readinessFailures.set(reason, (readinessFailures.get(reason) || 0) + 1);
  }
  return {
    latestAddress: latestCheck?.address || latest(estimatorWalletReadinessFailures)?.address || null,
    routeCount: latestChecks.length,
    readyCount: latestChecks.filter((item) => item.overallReady).length,
    nativeBlockedCount: latestChecks.filter((item) => item.native && !item.native.ok).length,
    tokenBlockedCount: latestChecks.filter((item) => item.token && !item.token.ok).length,
    allowanceBlockedCount: latestChecks.filter((item) => item.allowance && !item.allowance.ok).length,
    recentFailureCount24h: countRecent(estimatorWalletReadinessFailures, now, 24),
    latestCheck: latestCheck
      ? {
          observedAt: latestCheck.observedAt,
          ageMinutes: minutesBetween(latestCheck.observedAt, now),
          srcChain: latestCheck.srcChain,
          dstChain: latestCheck.dstChain,
          overallReady: latestCheck.overallReady,
          nativeOk: latestCheck.native?.ok ?? null,
          tokenOk: latestCheck.token?.ok ?? null,
          allowanceOk: latestCheck.allowance?.ok ?? null,
        }
      : null,
    failureReasons: [...readinessFailures.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
}

function humanShadowCycleAuditIssue(issue) {
  return {
    configured_address_stale_vs_resolved_cycle_address: "기본 지갑 설정이 최신 운영 주소와 다름",
    explicit_address_differs_from_latest_inventory: "지정한 주소와 최신 운영 지갑이 다름",
    latest_inventory_and_wallet_readiness_addresses_differ: "지갑 준비 기록과 재고 주소가 다름",
    resolved_address_differs_from_latest_inventory: "현재 사이클 주소와 최신 재고 주소가 다름",
    resolved_address_differs_from_latest_wallet_readiness: "현재 사이클 주소와 준비 점검 주소가 다름",
    inventory_snapshot_missing: "지갑 재고 스냅샷이 없음",
    inventory_snapshot_address_mismatch: "지갑 재고 스냅샷 주소가 다름",
    inventory_summary_value_mismatch: "지갑 평가값과 보유 자산 합계가 다름",
  }[issue] || issue;
}

function humanTreasuryNeedActivation(code) {
  return {
    demand_active_now: "현재 수요 기준 보강 가능",
    awaiting_wallet_readiness_check: "지갑 준비 점검이 더 필요함",
    awaiting_wallet_readiness_retry: "지갑 준비 재점검이 필요함",
    awaiting_tx_payload: "실행 payload 확인이 더 필요함",
    awaiting_score_gap_clear: "점수 데이터 공백 해소가 필요함",
    awaiting_route_viability: "경로 적합성 확인이 더 필요함",
    no_candidate_route: "해당 체인 수요 후보가 아직 없음",
  }[code] || code;
}

function money(value) {
  if (!Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 100 ? 0 : abs >= 1 ? 2 : 6;
  return `${value < 0 ? "-" : ""}$${abs.toLocaleString("ko-KR", { maximumFractionDigits })}`;
}

function humanTradeReadiness(code, netEdgeUsd) {
  if (!code) return { label: null, detail: null };
  if (code === "reject_no_net_edge") {
    return {
      label: "알려진 비용 반영 후 순이익이 아직 음수",
      detail: Number.isFinite(netEdgeUsd) ? `순엣지 ${money(netEdgeUsd)}` : "순엣지가 아직 음수",
    };
  }
  if (code === "shadow_candidate_review_only") {
    return {
      label: "수동 canary 검토 가능",
      detail: Number.isFinite(netEdgeUsd) ? `추정 순엣지 ${money(netEdgeUsd)}` : null,
    };
  }
  if (code === "insufficient_data") {
    return {
      label: "가격 또는 가스 데이터가 아직 부족함",
      detail: null,
    };
  }
  if (code === "observe_only_slow_settlement") {
    return {
      label: "정산 지연이 커서 아직 관찰 전용",
      detail: null,
    };
  }
  if (code === "reject_high_failure_rate") {
    return {
      label: "실패율이 높아 아직 진행 불가",
      detail: null,
    };
  }
  return {
    label: code,
    detail: Number.isFinite(netEdgeUsd) ? `순엣지 ${money(netEdgeUsd)}` : null,
  };
}

function shadowCycleSummary(shadowCycle, now) {
  if (!shadowCycle) return null;
  const topRouteTradeReadiness = humanTradeReadiness(shadowCycle.topRoute?.tradeReadiness || null, shadowCycle.topRoute?.netEdgeUsd);

  return {
    observedAt: shadowCycle.observedAt || null,
    ageMinutes: minutesBetween(shadowCycle.observedAt, now),
    mode: shadowCycle.mode || null,
    headline: shadowCycle.headline || null,
    blockerCount: shadowCycle.blockers?.length || 0,
    canaryDecision: shadowCycle.canary?.decision || null,
    canary: shadowCycle.canary
      ? {
          decision: shadowCycle.canary.decision || null,
          nextReadinessCheck: shadowCycle.canary.nextReadinessCheck
            ? {
                label: shadowCycle.canary.nextReadinessCheck.label || null,
                amount: shadowCycle.canary.nextReadinessCheck.amount || null,
                srcChain: shadowCycle.canary.nextReadinessCheck.srcChain || null,
                srcTicker: shadowCycle.canary.nextReadinessCheck.srcTicker || null,
                dstChain: shadowCycle.canary.nextReadinessCheck.dstChain || null,
                dstTicker: shadowCycle.canary.nextReadinessCheck.dstTicker || null,
              }
            : null,
          nextReadinessRefresh: shadowCycle.canary.nextReadinessRefresh
            ? {
                state: shadowCycle.canary.nextReadinessRefresh.state || null,
                reason: shadowCycle.canary.nextReadinessRefresh.reason || null,
                latestObservedAt: shadowCycle.canary.nextReadinessRefresh.latestObservedAt || null,
                ageSeconds: shadowCycle.canary.nextReadinessRefresh.ageSeconds ?? null,
                maxAgeSeconds: shadowCycle.canary.nextReadinessRefresh.maxAgeSeconds ?? null,
              }
            : null,
          readinessCheckCount: shadowCycle.canary.readinessCheckCount ?? 0,
        }
      : null,
    topRoute: shadowCycle.topRoute
      ? {
          label: shadowCycle.topRoute.label || null,
          amount: shadowCycle.topRoute.amount || null,
          tradeReadiness: shadowCycle.topRoute.tradeReadiness || null,
          tradeReadinessLabel: topRouteTradeReadiness.label,
          tradeReadinessDetail: topRouteTradeReadiness.detail,
          netEdgeUsd: shadowCycle.topRoute.netEdgeUsd ?? null,
        }
      : null,
    treasury: shadowCycle.treasury
      ? {
          decision: shadowCycle.treasury.decision || null,
          estimatedWalletUsd: shadowCycle.treasury.estimatedWalletUsd ?? null,
          walletValueFloorUsd: shadowCycle.treasury.walletValueFloorUsd ?? null,
          walletValueShortfallUsd: shadowCycle.treasury.walletValueShortfallUsd ?? null,
          noDemandBlockerCount: shadowCycle.treasury.noDemandBlockerCount ?? 0,
          nextNeeds: (shadowCycle.treasury.nextNeeds || []).map((item) => ({
            state: item.state || null,
            chain: item.chain || null,
            ticker: item.ticker || null,
            refillAmountDecimal: item.refillAmountDecimal ?? null,
            refillEstimatedUsd: item.refillEstimatedUsd ?? null,
            activation: item.activation
              ? {
                  code: item.activation.code || null,
                  label: humanTreasuryNeedActivation(item.activation.code),
                  routeLabel: item.activation.routeLabel || null,
                  candidateCount: item.activation.candidateCount ?? 0,
                }
              : null,
          })),
        }
      : null,
    audit: {
      addressConsistent: shadowCycle.audit?.address?.consistent ?? null,
      inventoryConsistent: shadowCycle.audit?.inventory?.consistent ?? null,
      issueCount:
        (shadowCycle.audit?.address?.issues?.length || 0) + (shadowCycle.audit?.inventory?.issues?.length || 0),
      issues: [
        ...(shadowCycle.audit?.address?.issues || []),
        ...(shadowCycle.audit?.inventory?.issues || []),
      ].map((issue) => ({
        code: issue,
        label: humanShadowCycleAuditIssue(issue),
      })),
    },
  };
}

function decideOverall({ audit, gateway, gas }) {
  const blockers = [];
  if (audit.decision !== "LIVE_CANARY_REVIEW_POSSIBLE") blockers.push("audit_blocks_live");
  if (gateway.updateDetected) blockers.push("gateway_update_pending_review");
  if (gateway.probeFailures.length > 0) blockers.push("gateway_probe_failures");
  if (gas.missingGatewayGasChainCount > 0) blockers.push("missing_gateway_gas_snapshots");
  if (gas.staleChainCount30m > 0) blockers.push("stale_gas_snapshots");

  return {
    severity: blockers.length > 0 ? "blocked" : "review",
    liveTrading: "BLOCKED",
    shadowTrading: audit.shadow,
    blockers,
    riskBudgetUsd: RISK_BUDGET_USD,
    lossLimitUsd: RISK_BUDGET_USD,
    capitalRule: "Only a ring-fenced wallet capped near USD 300 may be used in a future canary.",
  };
}

export function buildDashboardStatus(input, options = {}) {
  const now = options.now || new Date().toISOString();
  const audit = buildOverfitAudit(
    {
      routesRecords: input.routesRecords || [],
      quotes: input.quotes || [],
      failures: input.failures || [],
      gasSnapshots: input.gasSnapshots || [],
      gasFailures: input.gasFailures || [],
      now,
    },
    options.auditTargets,
  );
  const latestRoutesRecord = latest(input.routesRecords || []);
  const latestUpdateSnapshot = latest(input.updateSnapshots || []);
  const latestUpdateAlert = latest(input.updateAlerts || []);
  const gateway = gatewaySummary({
    latestRoutesRecord,
    latestUpdateSnapshot,
    latestUpdateAlert,
    updateAlerts: input.updateAlerts || [],
    quotes: input.quotes || [],
    failures: input.failures || [],
    now,
  });
  const gas = gasSummary({
    gasSnapshots: input.gasSnapshots || [],
    gasFailures: input.gasFailures || [],
    gatewayChains: gateway.chains,
    now,
  });
  const auditStatus = auditSummary(audit);
  const overall = decideOverall({ audit: auditStatus, gateway, gas });
  const opportunity = opportunitySummary(input.scoreSnapshot || null);
  const dex = dexSummary({ dexQuotes: input.dexQuotes || [], dexFailures: input.dexFailures || [], now });
  const bitcoinFee = bitcoinFeeSummary({ bitcoinFeeSnapshots: input.bitcoinFeeSnapshots || [], now });
  const executionGas = executionGasSummary({
    gatewayGasEstimates: input.gatewayGasEstimates || [],
    gatewayGasEstimateFailures: input.gatewayGasEstimateFailures || [],
    now,
  });
  const estimatorWallet = estimatorWalletSummary({
    estimatorWalletReadiness: input.estimatorWalletReadiness || [],
    estimatorWalletReadinessFailures: input.estimatorWalletReadinessFailures || [],
    now,
  });
  const shadowCycle = shadowCycleSummary(input.shadowCycle || null, now);

  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    generatedAt: now,
    overall,
    gateway,
    gas,
    executionGas,
    estimatorWallet,
    shadowCycle,
    bitcoinFee,
    opportunity,
    dex,
    audit: auditStatus,
    dataCounts: {
      routesRecords: input.routesRecords?.length || 0,
      quotes: input.quotes?.length || 0,
      quoteFailures: input.failures?.length || 0,
      gasSnapshots: input.gasSnapshots?.length || 0,
      gasFailures: input.gasFailures?.length || 0,
      updateSnapshots: input.updateSnapshots?.length || 0,
      updateAlerts: input.updateAlerts?.length || 0,
      dexQuotes: input.dexQuotes?.length || 0,
      dexFailures: input.dexFailures?.length || 0,
      bitcoinFeeSnapshots: input.bitcoinFeeSnapshots?.length || 0,
      gatewayGasEstimates: input.gatewayGasEstimates?.length || 0,
      gatewayGasEstimateFailures: input.gatewayGasEstimateFailures?.length || 0,
      estimatorWalletReadiness: input.estimatorWalletReadiness?.length || 0,
      estimatorWalletReadinessFailures: input.estimatorWalletReadinessFailures?.length || 0,
      shadowCyclePresent: shadowCycle ? 1 : 0,
    },
    exposurePolicy: {
      cloudflare: "dashboard_only",
      containsPrivateKeys: false,
      containsWalletSigning: false,
      containsExecutionPermission: false,
    },
  };
}

export async function writeDashboardStatus(dataDir, status, fileName = "dashboard-status.json") {
  const path = join(dataDir, fileName);
  await mkdir(dataDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  return path;
}
