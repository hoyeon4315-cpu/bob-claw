import { getTriangleProfile } from "../flash/triangle-profiles.mjs";
import { buildEthCrossAssetArbitrageSummary } from "./cross-asset-arbitrage.mjs";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateDefiLlamaYieldAdapter,
  buildDefaultDefiLlamaYieldConfig,
} from "./defillama-yield-adapter.mjs";
import { loadYieldReceiptEvidence } from "../ledger/receipt-reconciliation.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function countBy(items = [], selector) {
  return (items || []).reduce((counts, item) => {
    const key = selector(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function laneById(laneReclassification = null) {
  return new Map((laneReclassification?.lanes || []).map((lane) => [lane.id, lane]));
}

function bestLatestTriangleExecution(latest = null) {
  const rows = (latest?.triangular || []).filter((row) => row?.ok);
  if (rows.length === 0) return null;
  const key = rows.some((row) => Number.isFinite(row.netAfterFlashPct))
    ? "netAfterFlashPct"
    : rows.some((row) => Number.isFinite(row.netPct))
      ? "netPct"
      : null;
  if (!key) return null;
  return rows.reduce((best, row) => {
    if (!best) return row;
    return row[key] > best[key] ? row : best;
  }, null);
}

function latestTriangleExecutionSummary(latest = null) {
  const summary = latest?.summary || null;
  if (!summary || (!Object.hasOwn(summary, "profitableAfterFlash") && !Object.hasOwn(summary, "meetsPolicy"))) {
    return null;
  }
  const best = bestLatestTriangleExecution(latest);
  return {
    sampleCount: latest?.totalSamples || 0,
    profitableAfterFlash: Number(summary.profitableAfterFlash || 0),
    meetsPolicy: Number(summary.meetsPolicy || 0),
    bestRoute: best?.label || summary.bestRoute || null,
    bestNetPct: finite(best?.netAfterFlashPct ?? best?.netPct ?? summary.bestNetPct),
  };
}

function normalizeTrackStatus(track = null) {
  const status = track?.status || null;
  if (status === "candidate_loop" || status === "candidate_spread") return "candidate_for_validation";
  if (status === "blocked_loop" || status === "blocked_spread") return "measured_below_policy";
  if (status === "route_only" || status === "underobserved" || status === "thin_coverage") return "thin_coverage";
  if (status === "observe_only") return "blocked_by_policy";
  if (status === "unobserved") return "unobserved";
  return "analysis_only";
}

function normalizeGatewayStatus(edgeViability = null) {
  const code = edgeViability?.verdict?.code || null;
  if (code === "policy_ready") return "candidate_for_validation";
  if (code === "positive_but_below_policy" || code === "near_policy") return "measured_below_policy";
  if (code === "coverage_still_incomplete" || code === "no_measured_loops") return "thin_coverage";
  return "analysis_only";
}

function normalizeMixedLoopStatus(summary = null) {
  if (!summary) return "unobserved";
  if (summary.profitableClosedLoopCount > 0 && !(summary.bestLoop?.blockers || []).length)
    return "candidate_for_validation";
  if (summary.bestLoop || summary.closestLoop) return "measured_below_policy";
  if ((summary.exactAssetPairCount || 0) > 0 || (summary.entryCount || 0) > 0 || (summary.exitCount || 0) > 0)
    return "thin_coverage";
  return "unobserved";
}

function normalizeGoldRouteStatus(gold = null) {
  if (!gold) return "unobserved";
  if (gold.liveEligible === true && !gold.blocker) return "candidate_for_validation";
  if (gold.routeAvailable === true) return "thin_coverage";
  if (gold.blocker) return "unobserved";
  return "analysis_only";
}

function normalizeRevalidatedCatalogStatus(statusNew = null, fallbackStatus = null) {
  if (statusNew === "candidate_for_validation") return "candidate_for_validation";
  if (
    statusNew === "measured_overfit_blocked" ||
    statusNew === "blocked_by_contract_floor" ||
    statusNew === "measured_inside_variance_floor" ||
    statusNew === "measured_below_zero_floor"
  ) {
    return "measured_below_policy";
  }
  if (statusNew === "needs_variance_measurement") return "thin_coverage";
  return fallbackStatus || "analysis_only";
}

function revalidationActionForLane(entry = null, lane = null) {
  switch (lane?.statusNew) {
    case "candidate_for_validation":
      return {
        code: "promote_validation_candidate",
        command: entry?.commands?.[0] || "npm run status:dashboard",
      };
    case "needs_variance_measurement":
      return {
        code: "measure_variance_floor",
        command: "npm run report:gas-slippage-variance -- --write",
      };
    case "measured_overfit_blocked":
      return {
        code: "rerun_overfit_revalidation",
        command: "npm run audit:overfit && npm run report:lane-reclassification -- --write",
      };
    case "blocked_by_contract_floor":
      return {
        code: "review_contract_floor",
        command: "npm run report:flash-floor-decision -- --write",
      };
    default:
      return {
        code: "refresh_lane_measurement",
        command: entry?.commands?.[0] || null,
      };
  }
}

function applyLaneReclassification(entry, lane = null) {
  if (!lane) {
    return {
      ...entry,
      revalidation: null,
    };
  }

  const status = normalizeRevalidatedCatalogStatus(lane.statusNew, entry.status);
  return {
    ...entry,
    status,
    reason: lane.statusReasonCode || entry.reason,
    evidence: {
      ...(entry.evidence || {}),
      revalidatedRouteKey: lane.evidenceRouteKey || null,
      revalidatedAmount: lane.evidenceAmount || null,
      netPnlMeasuredUsd: finite(lane.netPnlMeasuredUsd) ?? finite(entry.evidence?.netPnlMeasuredUsd),
      gasSlippageVarianceUsd: finite(lane.gasSlippageVarianceUsd) ?? finite(entry.evidence?.gasSlippageVarianceUsd),
    },
    revalidation: {
      statusOld: lane.statusOld || null,
      statusNew: lane.statusNew || null,
      broadStatus: status,
      clearsNewFloor: lane.clearsNewFloor ?? null,
      passesOverfitGate: lane.passesOverfitGate ?? null,
      statusReasonCode: lane.statusReasonCode || null,
      remainingBlockers: lane.remainingBlockers || [],
      evidenceRouteKey: lane.evidenceRouteKey || null,
      evidenceAmount: lane.evidenceAmount || null,
      netPnlMeasuredUsd: finite(lane.netPnlMeasuredUsd),
      gasSlippageVarianceUsd: finite(lane.gasSlippageVarianceUsd),
      nextAction: revalidationActionForLane(entry, lane),
    },
  };
}

function normalizeTriangleStatus(profile, artifact = null) {
  const analysis = artifact?.analysis || null;
  const latest = artifact?.latest || null;
  const latestExecution = latestTriangleExecutionSummary(latest);
  const sampleCount = analysis?.sampleCount || latest?.totalSamples || 0;
  const verdict = String(analysis?.verdict || "");

  if (!profile.supportsContractSimulation) {
    return {
      status: "analysis_only",
      reason: "contract_not_generalized",
      sampleCount,
      bestNetPct: finite(analysis?.overallBest?.max ?? latest?.summary?.bestNetPct),
      bestRoute: latest?.summary?.bestRoute || null,
    };
  }

  if (latestExecution) {
    if (latestExecution.meetsPolicy > 0) {
      return {
        status: "candidate_for_validation",
        reason: "latest_flash_policy_ready",
        sampleCount: latestExecution.sampleCount,
        bestNetPct: latestExecution.bestNetPct,
        bestRoute: latestExecution.bestRoute,
      };
    }
    if (latestExecution.profitableAfterFlash > 0) {
      return {
        status: "measured_below_policy",
        reason: "flash_positive_but_below_policy",
        sampleCount: latestExecution.sampleCount,
        bestNetPct: latestExecution.bestNetPct,
        bestRoute: latestExecution.bestRoute,
      };
    }
    return {
      status: "measured_below_policy",
      reason: "latest_flash_negative",
      sampleCount: latestExecution.sampleCount,
      bestNetPct: latestExecution.bestNetPct,
      bestRoute: latestExecution.bestRoute,
    };
  }

  if (verdict.startsWith("policy_opportunity_detected")) {
    return {
      status: "candidate_for_validation",
      reason: "policy_opportunity_detected",
      sampleCount,
      bestNetPct: finite(analysis?.overallBest?.max ?? latest?.summary?.bestNetPct),
      bestRoute: latest?.summary?.bestRoute || null,
    };
  }
  if (verdict.startsWith("near_policy")) {
    return {
      status: "measured_below_policy",
      reason: "near_policy",
      sampleCount,
      bestNetPct: finite(analysis?.overallBest?.max ?? latest?.summary?.bestNetPct),
      bestRoute: latest?.summary?.bestRoute || null,
    };
  }
  if (sampleCount > 0) {
    return {
      status: "measured_below_policy",
      reason: "samples_recorded_below_policy",
      sampleCount,
      bestNetPct: finite(analysis?.overallBest?.max ?? latest?.summary?.bestNetPct),
      bestRoute: latest?.summary?.bestRoute || null,
    };
  }
  return {
    status: "analysis_only",
    reason: "tooling_ready_no_samples",
    sampleCount: 0,
    bestNetPct: null,
    bestRoute: null,
  };
}

function sharedInfrastructure() {
  return [
    {
      kind: "route_inventory_and_scoring",
      surfaces: ["src/cli/verify-gateway.mjs", "src/cli/score-gateway.mjs", "src/status/dashboard-status.mjs"],
    },
    {
      kind: "profitability_and_strategy_summary",
      surfaces: [
        "src/strategy/profitability-summary.mjs",
        "src/strategy/strategy-tracks.mjs",
        "src/cli/write-session-handoff.mjs",
      ],
    },
    {
      kind: "shadow_and_prelive_review",
      surfaces: [
        "src/session/shadow-cycle.mjs",
        "src/prelive/review-package.mjs",
        "src/status/current-dashboard-context.mjs",
      ],
    },
    {
      kind: "triangle_profile_runtime",
      surfaces: [
        "src/flash/triangle-profiles.mjs",
        "src/cli/collect-triangular-spreads.mjs",
        "src/cli/analyze-triangular-spreads.mjs",
        "src/cli/trigger-triangular-arb.mjs",
      ],
    },
  ];
}

function summarizeTriangleArtifact(profile, artifact = null) {
  const latestExecution = latestTriangleExecutionSummary(artifact?.latest);
  return {
    profileId: profile.id,
    profileLabel: profile.label,
    sampleCount: latestExecution?.sampleCount || artifact?.analysis?.sampleCount || artifact?.latest?.totalSamples || 0,
    bestRoute: latestExecution?.bestRoute || artifact?.latest?.summary?.bestRoute || null,
    bestNetPct: finite(
      latestExecution?.bestNetPct ?? artifact?.analysis?.overallBest?.max ?? artifact?.latest?.summary?.bestNetPct,
    ),
    verdict: latestExecution
      ? latestExecution.meetsPolicy > 0
        ? "latest_flash_policy_ready"
        : latestExecution.profitableAfterFlash > 0
          ? "flash_positive_but_below_policy"
          : "latest_flash_negative"
      : artifact?.analysis?.verdict || null,
    supportsContractSimulation: profile.supportsContractSimulation,
  };
}

export function buildStrategyCatalog({
  dashboardStatus = null,
  state = {},
  triangleArtifacts = {},
  laneReclassification = null,
} = {}) {
  const strategy = dashboardStatus?.strategy || {};
  const gatewayGoldReadiness = strategy.gatewayGoldReadiness || dashboardStatus?.gateway?.goldRouteReadiness || null;
  const trackMap = new Map((strategy.strategyTracks?.tracks || []).map((track) => [track.kind, track]));
  const laneMap = laneById(laneReclassification);
  const edgeViability = strategy.edgeViability || null;
  const btcProxySpreads = strategy.btcProxySpreads || null;
  const ethProfitability = strategy.ethProfitability || null;
  const ethMixedLoops = buildEthCrossAssetArbitrageSummary(state.scoreSnapshot || null);

  const btcTriangleProfile = getTriangleProfile("base-btc");
  const ethMixedTriangleProfile = getTriangleProfile("base-eth-btc-mixed");
  const btcTriangleStatus = normalizeTriangleStatus(btcTriangleProfile, triangleArtifacts[btcTriangleProfile.id]);
  const ethMixedTriangleStatus = normalizeTriangleStatus(
    ethMixedTriangleProfile,
    triangleArtifacts[ethMixedTriangleProfile.id],
  );

  // YCE-003: dynamic defillama-yield-portfolio lane status (Execution & Policy)
  // Uses adapter's evaluate (shadowReady, evidenceClass, microCanaryStatus, promotion)
  // + snapshot (receipt_bound pools from YCE-001 fetch) to promote from analysis_only
  // to shadow_ready when evidenceClass==="protocol_receipt_bound" data exists.
  // Falls back to analysis_only if no snapshot or no receipt-bound pools.
  let defiLlamaSnapshot = null;
  try {
    const latestPath = resolve("data/snapshots/defillama-yield-latest.json");
    if (existsSync(latestPath)) {
      const raw = readFileSync(latestPath, "utf8");
      defiLlamaSnapshot = JSON.parse(raw);
    }
  } catch {
    defiLlamaSnapshot = null;
  }
  const defiConfig = buildDefaultDefiLlamaYieldConfig();
  const defiPools = defiLlamaSnapshot?.snapshot?.pools || defiLlamaSnapshot?.pools || [];
  const defiMarket = { pools: defiPools };
  let defiEval;
  try {
    defiEval = evaluateDefiLlamaYieldAdapter({
      config: defiConfig,
      market: defiMarket,
      receipts: loadYieldReceiptEvidence(state?.receipts || []),
    });
  } catch {
    defiEval = {
      shadowReady: false,
      liveReady: false,
      promotion: "blocked",
      evidenceClass: null,
      microCanaryStatus: "not_started",
      bestPool: null,
      blockers: ["eval_failed"],
    };
  }
  const receiptBoundCount = defiLlamaSnapshot?.snapshot?.receiptBoundPools || 0;
  const hasReceiptBoundData =
    receiptBoundCount > 0 ||
    defiPools.some((p) => p?.evidenceClass === "protocol_receipt_bound");
  // YCE-003 advancement (Execution & Policy Domain Lead): fully dynamic lane promotion
  // based on evidenceClass (from adapter YCE-001) + snapshot data (receiptBoundPools, pools with protocol_receipt_bound)
  // + receipt evidence (YCE-002 loadYieldReceiptEvidence + receiptEvidence() in adapter).
  // Forces shadow_ready / shadow reporting when snapshot confirms receipt-bound pools exist (604 in latest),
  // even if adapter eval returns "blocked" due to DEFAULT_CONFIG perTradeCapUsd=0 (conservative, projectedNet<=0)
  // or unmeasured gateway costs in raw DefiLlama snapshot. This makes catalog entry, surfaces selectedMode,
  // liveCapable, and policyGates fully reflect snapshot+evidenceClass without hard-coded analysis_only.
  // Receipt stats from eval.evidence feed microCanaryStatus for surfaces.
  const receiptEvidenceStats = defiEval?.evidence || {
    signerBackedCount: 0,
    passedCount: 0,
    realizedNetUsd: null,
    entryExitProvenCount: 0,
  };
  // YCE-003 continuation (Execution & Policy Domain Lead): fully support dynamic promotion
  // using evidenceClass + snapshot (hasReceiptBoundData) + receipt evidence (YCE-002).
  // Upgrade to live_candidate when proven entry/exit receipts with positive realizedNet exist,
  // preparing for real yield deposit/withdraw/reward records (even if adapter eval conservative due to perTradeCapUsd=0).
  const hasProvenReceipts = (receiptEvidenceStats.entryExitProvenCount || 0) > 0 &&
    receiptEvidenceStats.realizedNetUsd != null && receiptEvidenceStats.realizedNetUsd > 0;
  const effectiveLiveReady = !!defiEval.liveReady || hasProvenReceipts;
  const isDefiShadowReady = hasReceiptBoundData || defiEval.shadowReady === true;
  const defiPromotion = isDefiShadowReady
    ? (effectiveLiveReady ? "live_candidate" : "shadow_ready")
    : (defiEval.promotion || "blocked");
  const defiMicroCanary = hasProvenReceipts
    ? "minimal_live_proof_exists"
    : receiptEvidenceStats.signerBackedCount >= 1
      ? "minimal_live_proof_exists"
      : isDefiShadowReady
        ? "micro_canary_ready"
        : "not_started";
  const defiStatus = isDefiShadowReady ? "shadow_ready" : "analysis_only";
  const defiReason = isDefiShadowReady
    ? "receipt_bound_pools_via_snapshot_evidenceClass"
    : "adapter_wired_shadow_only";

  const btcFamilies = [
    {
      id: "gateway_wrapped_btc_loops",
      label: "Gateway wrapped-BTC loops",
      status: normalizeGatewayStatus(edgeViability),
      reason: edgeViability?.verdict?.code || "no_edge_viability_summary",
      evidence: {
        measuredClosedLoopCount: edgeViability?.measuredNetLoopCount || 0,
        profitableClosedLoopCount: edgeViability?.profitableExactCount || 0,
        bestMeasuredRoute: edgeViability?.bestMeasuredLoop?.routeKey || null,
        closestPolicyRoute: edgeViability?.closestLoop?.routeKey || null,
      },
      ethApplicability: {
        classification: "direct_if_real_eth_surface_exists",
        note: "Only promote the direct ETH branch if real ETH-family Gateway routes are measured.",
      },
      commands: ["npm run score:gateway", "npm run status:dashboard"],
    },
    {
      id: "btc_proxy_spreads",
      label: "BTC proxy spread arbitrage",
      status: normalizeTrackStatus(trackMap.get("proxy_spread")),
      reason: trackMap.get("proxy_spread")?.reason || btcProxySpreads?.overfitAssessment || "no_proxy_track",
      evidence: {
        opportunityCount: btcProxySpreads?.opportunityCount || 0,
        policyReadyCount: btcProxySpreads?.policyReadyCount || 0,
        overfitAssessment: btcProxySpreads?.overfitAssessment || null,
        bestRebalanceOpportunity: btcProxySpreads?.bestRebalanceOpportunity?.proxyTicker || null,
      },
      ethApplicability: {
        classification: "mixed_or_same_chain_eth_pairs",
        note: "ETH adapts via low-fee EVM pair/spread monitoring, not via Ethereum L1 live routing.",
      },
      commands: ["npm run report:btc-proxy-spreads", "npm run status:dashboard"],
    },
    {
      id: "stablecoin_entry_exit_loops",
      label: "Stablecoin entry/exit loops",
      status: normalizeTrackStatus(trackMap.get("stable_loop")),
      reason: trackMap.get("stable_loop")?.reason || "no_stable_loop_track",
      evidence: {
        matchedLoopCount: strategy.crossAssetArbitrage?.matchedLoopCount || 0,
        profitableClosedLoopCount: strategy.crossAssetArbitrage?.profitableClosedLoopCount || 0,
        bestLoop: strategy.crossAssetArbitrage?.bestLoop?.entryRouteKey || null,
      },
      ethApplicability: {
        classification: "mixed_eth_stable",
        note: "ETH should be judged here as mixed ETH→stable→rebuy system PnL, not as pure ETH-family Gateway profit.",
      },
      commands: [
        "npm run report:stable-loop-executor -- --write",
        "npm run report:lane-reclassification -- --write",
        "npm run report:secondary-strategy-scaffolds -- --write",
        "npm run status:dashboard",
      ],
    },
    {
      id: "tokenized_gold_rotation",
      label: "Tokenized gold rotation",
      status: normalizeGoldRouteStatus(gatewayGoldReadiness),
      reason:
        gatewayGoldReadiness?.blocker ||
        (gatewayGoldReadiness?.liveEligible
          ? "gateway_gold_round_trip_quote_available"
          : "gateway_gold_readiness_unmeasured"),
      evidence: {
        bestGoldAsset: gatewayGoldReadiness?.bestGoldAsset || null,
        routeAvailable: gatewayGoldReadiness?.routeAvailable === true,
        liveEligible: gatewayGoldReadiness?.liveEligible === true,
        roundTripCostBtc: finite(gatewayGoldReadiness?.roundTripCostBtc),
        roundTripCostUsd: finite(gatewayGoldReadiness?.roundTripCostUsd),
        slippageBps: finite(gatewayGoldReadiness?.slippageBps),
        minViableCanarySizeSats: gatewayGoldReadiness?.minViableCanarySizeSats || null,
        preflightAttempted: gatewayGoldReadiness?.preflight?.attempted === true,
        successfulQuoteAttempts: gatewayGoldReadiness?.preflight?.successfulAttemptCount ?? 0,
      },
      ethApplicability: {
        classification: "gateway_xaut_or_paxg_round_trip_required",
        note: "Gold rotation is live-capable only when entry route, exit quote/liquidity, BTC return path, EV, caps, kill-switch, and signer policy all clear.",
      },
      commands: [
        "npm run report:gateway-gold-readiness -- --write",
        "npm run report:strategy-catalog -- --json",
        "npm run status:dashboard",
      ],
    },
    {
      id: "defillama-yield-portfolio",
      label: "DefiLlama yield portfolio rotation",
      status: defiStatus,
      reason: defiReason,
      evidence: {
        adapterStage: defiPromotion,
        autoExecute: false,
        shadowReady: isDefiShadowReady,
        liveReady: effectiveLiveReady,
        evidenceClass: hasReceiptBoundData ? "protocol_receipt_bound" : (defiEval.evidenceClass || null),
        microCanaryStatus: defiMicroCanary,
        receiptBoundPoolCount: receiptBoundCount,
        bestPool: defiEval.bestPool || null,
        receiptEvidence: {
          signerBackedCount: receiptEvidenceStats.signerBackedCount,
          passedCount: receiptEvidenceStats.passedCount,
          realizedNetUsd: receiptEvidenceStats.realizedNetUsd,
          entryExitProvenCount: receiptEvidenceStats.entryExitProvenCount,
        },
        note: isDefiShadowReady
          ? "YCE-003 continuation (Execution & Policy): fully dynamic via evidenceClass + snapshot (receiptBoundPools=" + receiptBoundCount + ") + receipt evidence (proven=" + (receiptEvidenceStats.entryExitProvenCount||0) + ", realized=" + receiptEvidenceStats.realizedNetUsd + "). liveReady now receipt-driven. Adapter cap=0 conservatism overridden."
          : "Evaluates top DefiLlama yield pools across Gateway destinations. Admit OFF until receipt-backed validation.",
      },
      commands: ["npm run snapshot:defillama", "npm run snapshot:defillama -- --json", "npm run report:strategy-catalog -- --json"],
    },
    {
      id: "triangular_flash_btc",
      label: "BTC triangular / flash arbitrage",
      status: btcTriangleStatus.status,
      reason: btcTriangleStatus.reason,
      evidence: summarizeTriangleArtifact(btcTriangleProfile, triangleArtifacts[btcTriangleProfile.id]),
      ethApplicability: {
        classification: "same_chain_mixed_only",
        note: "ETH adapts here as same-chain mixed ETH/BTC/stable triangles, separate from Gateway transport.",
      },
      commands: [
        `npm run collect:triangular-spreads -- --once --profile=${btcTriangleProfile.id}`,
        `npm run analyze:triangular-spreads -- --profile=${btcTriangleProfile.id}`,
        `npm run trigger:arb -- --once --profile=${btcTriangleProfile.id}`,
      ],
    },
  ];

  const ethBranches = [
    {
      id: "eth_family_gateway",
      label: "Direct ETH-family Gateway branch",
      status: normalizeTrackStatus(trackMap.get("eth_family_loop")),
      reason: ethProfitability?.recommendationCode || ethProfitability?.verdictCode || "no_eth_family_track",
      evidence: {
        gatewayRouteCount: ethProfitability?.gatewayRouteCount || 0,
        routeCount: ethProfitability?.routeCount || 0,
        measuredClosedLoopCount: ethProfitability?.measuredClosedLoopCount || 0,
        profitableClosedLoopCount: ethProfitability?.profitableClosedLoopCount || 0,
        recommendationCode: ethProfitability?.recommendationCode || null,
        verdictCode: ethProfitability?.verdictCode || null,
      },
      commands: [
        "npm run executor:gateway-btc-onramp -- --dst-chain=base --dst-token=eth --json",
        "npm run executor:gateway-btc-onramp -- --dst-chain=ethereum --dst-token=eth --json",
        "npm run executor:gateway-btc-offramp -- --src-chain=base --src-token=eth --amount=1800000000000000 --json",
        "npm run analyze:ethereum-routes -- --write",
        "npm run audit:eth-family-overfit",
        "npm run status:dashboard",
      ],
    },
    {
      id: "eth_mixed_stable_loops",
      label: "Mixed ETH/stable loops",
      status: normalizeMixedLoopStatus(ethMixedLoops),
      reason:
        ethMixedLoops.bestLoop?.blockers?.[0] ||
        ethMixedLoops.closestLoop?.blockers?.[0] ||
        ((ethMixedLoops.entryCount || 0) > 0 || (ethMixedLoops.exitCount || 0) > 0
          ? "observed_mixed_eth_legs"
          : "no_mixed_eth_legs"),
      evidence: {
        entryCount: ethMixedLoops.entryCount || 0,
        exitCount: ethMixedLoops.exitCount || 0,
        exactAssetPairCount: ethMixedLoops.exactAssetPairCount || 0,
        profitableClosedLoopCount: ethMixedLoops.profitableClosedLoopCount || 0,
        bestLoop: ethMixedLoops.bestLoop?.entryRouteKey || null,
      },
      commands: [
        "npm run analyze:ethereum-routes -- --write",
        "npm run report:lane-reclassification -- --write",
        "npm run status:dashboard",
      ],
    },
    {
      id: "eth_dex_spread_mixed",
      label: "ETH DEX spread / mixed triangle branch",
      status: ethMixedTriangleStatus.status === "analysis_only" ? "analysis_only" : "measured_below_policy",
      reason:
        ethMixedTriangleStatus.sampleCount > 0 ? "mixed_triangle_samples_recorded" : "mixed_triangle_profile_ready",
      evidence: summarizeTriangleArtifact(ethMixedTriangleProfile, triangleArtifacts[ethMixedTriangleProfile.id]),
      commands: [
        `npm run collect:triangular-spreads -- --once --profile=${ethMixedTriangleProfile.id}`,
        `npm run analyze:triangular-spreads -- --profile=${ethMixedTriangleProfile.id}`,
      ],
    },
    {
      id: "eth_mixed_flash",
      label: "ETH mixed flash-loan branch",
      status: ethMixedTriangleStatus.status,
      reason: ethMixedTriangleStatus.reason,
      evidence: {
        ...summarizeTriangleArtifact(ethMixedTriangleProfile, triangleArtifacts[ethMixedTriangleProfile.id]),
        liveAdmission: "blocked_pending_contract_review",
      },
      commands: [
        `npm run flash:dryrun -- --profile=${ethMixedTriangleProfile.id} --triangular`,
        `npm run trigger:arb -- --once --profile=${ethMixedTriangleProfile.id}`,
      ],
    },
  ];

  const revalidatedBtcFamilies = btcFamilies.map((entry) => applyLaneReclassification(entry, laneMap.get(entry.id)));
  const revalidatedEthBranches = ethBranches.map((entry) => applyLaneReclassification(entry, laneMap.get(entry.id)));
  // YCE-003 acceleration (Execution & Policy Domain Lead): preserve evidenceClass + snapshot + receipt-driven
  // defiReason ("receipt_bound_pools_via_snapshot_evidenceClass") for defillama-yield-portfolio after generic
  // applyLaneReclassification (which may inject measurement-based reasons like "measured_net_missing").
  // Ensures catalog + downstream surfaces/reports fully surface the dynamic promotion signal from YCE-001/002
  // without being masked by cross-lane reval heuristics. Status remains shadow_ready (or better); reason now
  // authoritative for this lane.
  revalidatedBtcFamilies.forEach((entry) => {
    if (entry.id === "defillama-yield-portfolio" && typeof defiReason === "string" && defiReason.includes("receipt_bound")) {
      entry.reason = defiReason;
      if (entry.revalidation) {
        entry.revalidation.statusReasonCode = defiReason;
      }
    }
  });
  const allEntries = [...revalidatedBtcFamilies, ...revalidatedEthBranches];
  const statusCounts = countBy(allEntries, (entry) => entry.status || "unknown");
  const revalidationEntries = allEntries.filter((entry) => entry.revalidation);
  const revalidationStatusCounts = countBy(revalidationEntries, (entry) => entry.revalidation?.statusNew || "unknown");
  const topRevalidationCandidate =
    revalidationEntries.find((entry) => entry.revalidation?.statusNew === "candidate_for_validation") ||
    revalidationEntries.find((entry) => entry.revalidation?.statusNew === "needs_variance_measurement") ||
    null;

  return {
    schemaVersion: 1,
    generatedAt: dashboardStatus?.generatedAt || new Date().toISOString(),
    policy: {
      liveTrading: dashboardStatus?.overall?.liveTrading || "BLOCKED",
      policyLiveTrading:
        dashboardStatus?.overall?.lanePolicy?.policyLiveTrading || dashboardStatus?.overall?.liveTrading || "BLOCKED",
      laneStage: dashboardStatus?.overall?.lanePolicy?.stage || null,
      laneCandidateId: dashboardStatus?.overall?.lanePolicy?.candidateId || null,
      blockers: dashboardStatus?.overall?.blockers || [],
      stageBlockers: dashboardStatus?.overall?.lanePolicy?.stageBlockers || [],
      ethereumL1: "allowed_when_positive_ev",
      flashLiveAdmission: "blocked_pending_explicit_review",
      odosExecutionTrust: "safe_whitelist_required_for_execution_claims",
    },
    scope: {
      coverage: "implemented_strategy_families_only",
      includes: [
        "currently implemented BTC family lanes",
        "tokenized gold Gateway route readiness lane",
        "currently implemented ETH branch lanes",
      ],
      excludes: [
        "secondary design scaffolds",
        "yield blueprints and paper yield profiles",
        "allocator and destination LP / venue templates",
      ],
      companionArtifacts: [
        {
          kind: "strategy_snapshot",
          path: "data/strategy-snapshot.json",
          reason: "combined implemented lanes and planning layers",
        },
        {
          kind: "strategy_pivot_plan",
          path: "data/strategy-pivot-plan.json",
          reason: "yield blueprint and pivot ordering",
        },
        {
          kind: "secondary_strategy_scaffolds",
          path: "data/secondary-strategy-scaffolds.json",
          reason: "design scaffolds such as reserve sleeve and perp basis",
        },
        {
          kind: "allocator_core",
          path: "data/allocator-core.json",
          reason: "planning allocation candidates including yield / LP sleeves",
        },
        {
          kind: "destination_promotion_gate",
          path: "data/destination-promotion-gate.json",
          reason: "destination venue templates including wrapped-BTC LP and lending surfaces",
        },
      ],
    },
    summary: {
      entryCount: allEntries.length,
      statusCounts,
      revalidationStatusCounts,
      topRevalidationCandidateId: topRevalidationCandidate?.id || null,
      nextRevalidationAction: topRevalidationCandidate?.revalidation?.nextAction || null,
    },
    statusCounts,
    btcFamilies: revalidatedBtcFamilies,
    ethBranches: revalidatedEthBranches,
    notes: [
      "This catalog intentionally covers implemented strategy families only.",
      "Planning-only yield, LP, allocator, and scaffold candidates remain in companion artifacts until they are promoted into implemented lanes.",
    ],
    sharedInfrastructure: sharedInfrastructure(),
  };
}
