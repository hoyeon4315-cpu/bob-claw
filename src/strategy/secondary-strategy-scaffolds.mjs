function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function countBy(items = [], selector) {
  return (items || []).reduce((counts, item) => {
    const key = selector(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function laneMap(laneReclassification = null) {
  return new Map((laneReclassification?.lanes || []).map((lane) => [lane.id, lane]));
}

function scaffold({
  rank,
  id,
  label,
  category,
  leverage,
  status,
  protocolTrack,
  whyNow,
  entryShape,
  watcherShape,
  unwindShape,
  blockers = [],
  missingEvidence = [],
  evidence = null,
  nextAction = null,
}) {
  return {
    rank,
    id,
    label,
    category,
    leverage,
    status,
    protocolTrack,
    whyNow,
    entryShape,
    watcherShape,
    unwindShape,
    blockers: unique(blockers),
    missingEvidence: unique(missingEvidence),
    evidence,
    nextAction,
  };
}

function stablecoinSpreadLoopScaffold(lanes) {
  const stableLane = lanes.get("stablecoin_entry_exit_loops") || null;
  return scaffold({
    rank: 1,
    id: "stablecoin_spread_loop",
    label: "Stablecoin spread loop",
    category: "yield",
    leverage: true,
    status: stableLane?.clearsNewFloor === true ? "design_scaffold" : "research_blocked",
    protocolTrack: {
      chains: ["base"],
      protocols: ["morpho", "aave_v3", "euler"],
      collateralAsset: "USDC",
      borrowAsset: "USDT",
    },
    whyNow:
      "Relaxed positive-EV handling makes small stable carry loops worth structuring once peg drift, borrow spread, and unwind cost are monitored explicitly.",
    entryShape: {
      type: "stable_supply_borrow_loop",
      requiredFields: ["perTradeCapUsd", "healthFactorMin", "liquidationBufferPct", "maxLoopIterations", "pegDriftTriggerPct"],
    },
    watcherShape: {
      checks: ["health_factor", "liquidation_buffer", "peg_drift", "borrow_rate_spike", "unwind_gas_budget"],
    },
    unwindShape: {
      path: "repay borrowed stable -> withdraw collateral stable -> unwind treasury sleeve",
      dryRunRequired: true,
    },
    blockers: [
      "stable_loop_protocol_adapter_not_built",
      "peg_divergence_feed_missing",
      "dry_run_receipt_missing",
      stableLane?.passesOverfitGate === false ? "overfit_gate_blocked" : null,
    ],
    missingEvidence: [
      "stable_to_stable_unwind_slippage_receipts",
      "borrow_spread_decay_samples",
      stableLane?.clearsNewFloor === true ? null : "positive_net_outside_variance_floor",
    ],
    evidence: stableLane
      ? {
          laneId: stableLane.id,
          statusNew: stableLane.statusNew,
          netPnlMeasuredUsd: stableLane.netPnlMeasuredUsd ?? null,
          gasSlippageVarianceUsd: stableLane.gasSlippageVarianceUsd ?? null,
        }
      : null,
    nextAction: {
      code: "build_stablecoin_spread_loop",
      command: null,
    },
  });
}

function proxySpreadExpansionScaffold(lanes) {
  const proxyLane = lanes.get("btc_proxy_spreads") || null;
  return scaffold({
    rank: 2,
    id: "proxy_spread_expansion",
    label: "Cross-wrapper proxy spread expansion",
    category: "arbitrage",
    leverage: false,
    status: "design_scaffold",
    protocolTrack: {
      chains: ["base", "bob", "bera", "unichain"],
      wrappers: ["WBTC", "wBTC.OFT", "LBTC", "cbBTC", "tBTC"],
    },
    whyNow:
      "The flat repo-wide profit floor is gone, so proxy-spread expansion should be judged on route coverage, amount diversity, and measured noise floor instead of old policy thresholds.",
    entryShape: {
      type: "cross_wrapper_rebalance",
      requiredFields: ["perTradeCapUsd", "amountLadder", "maxBridgeLatencyMs", "minQuoteSuccessRate"],
    },
    watcherShape: {
      checks: ["quote_success_rate", "latency", "wrapper_price_divergence", "bridge_route_staleness"],
    },
    unwindShape: {
      path: "rebalance into treasury-preferred wrapper -> Gateway return path",
      dryRunRequired: true,
    },
    blockers: [
      "wrapper_amount_ladder_incomplete",
      "receipt_backed_route_coverage_missing",
      proxyLane?.passesOverfitGate === false ? "overfit_gate_blocked" : null,
    ],
    missingEvidence: [
      "cross_wrapper_receipt_set",
      "out_of_sample_spread_decay",
      proxyLane?.clearsNewFloor === true ? null : "positive_net_outside_variance_floor",
    ],
    evidence: proxyLane
      ? {
          laneId: proxyLane.id,
          statusNew: proxyLane.statusNew,
          netPnlMeasuredUsd: proxyLane.netPnlMeasuredUsd ?? null,
        }
      : null,
    nextAction: {
      code: "expand_proxy_spread_ladder",
      command: "npm run report:btc-proxy-spreads",
    },
  });
}

function reserveSleeveScaffold() {
  return scaffold({
    rank: 3,
    id: "tokenized_reserve_sleeve",
    label: "Tokenized reserve sleeve",
    category: "macro_rotation",
    leverage: false,
    status: "design_scaffold",
    protocolTrack: {
      chains: ["ethereum", "base"],
      assets: ["PAXG", "XAUT", "USDY", "bIB01"],
    },
    whyNow:
      "A low-volatility reserve sleeve can improve allocator robustness even when pure trading edges are thin, but only if issuer and unwind liquidity are measured deterministically.",
    entryShape: {
      type: "reserve_allocation",
      requiredFields: ["perTradeCapUsd", "issuerAllowlist", "maxExitSlippageBps", "maxSettlementDelayHours"],
    },
    watcherShape: {
      checks: ["issuer_status", "exit_liquidity", "bridge_fee_spike", "market_risk_budget"],
    },
    unwindShape: {
      path: "exit reserve asset -> stable/treasury settlement -> Gateway return to BTC",
      dryRunRequired: true,
    },
    blockers: ["issuer_allowlist_missing", "exit_liquidity_measurement_missing", "market_risk_policy_not_bound"],
    missingEvidence: ["onchain_exit_liquidity_samples", "issuer_and_custody_review", "btc_roundtrip_cost_samples"],
    evidence: null,
    nextAction: {
      code: "measure_reserve_sleeve_liquidity",
      command: null,
    },
  });
}

function perpBasisScaffold() {
  return scaffold({
    rank: 4,
    id: "onchain_btc_perp_basis",
    label: "On-chain BTC perp basis",
    category: "yield",
    leverage: true,
    status: "design_scaffold",
    protocolTrack: {
      chains: ["base", "arbitrum"],
      venues: ["gmx", "vertex", "synthetix_v3"],
      spotAsset: "wrapped BTC",
      hedgeAsset: "BTC perpetual short",
    },
    whyNow:
      "Per-strategy caps and leverage policy now permit basis-style sleeves, but they need venue trust scoring, funding-rate telemetry, and liquidation-aware auto-unwind before any promotion.",
    entryShape: {
      type: "spot_plus_perp_hedge",
      requiredFields: ["perTradeCapUsd", "maxFundingFlipBps", "healthFactorMin", "liquidationBufferPct", "venueTrustTier"],
    },
    watcherShape: {
      checks: ["funding_rate_flip", "perp_margin_health", "oracle_divergence", "venue_liquidity_drawdown"],
    },
    unwindShape: {
      path: "close perp hedge -> release spot wrapper -> treasury settlement",
      dryRunRequired: true,
    },
    blockers: ["perp_venue_adapter_not_built", "funding_rate_feed_missing", "liquidation_model_missing", "dry_run_receipt_missing"],
    missingEvidence: ["funding_rate_history", "perp_closeout_slippage_receipts", "venue_trust_tier_review"],
    evidence: null,
    nextAction: {
      code: "measure_perp_basis_surface",
      command: null,
    },
  });
}

export function buildSecondaryStrategyScaffolds({ laneReclassification = null, now = null } = {}) {
  const lanes = laneMap(laneReclassification);
  const scaffolds = [
    stablecoinSpreadLoopScaffold(lanes),
    proxySpreadExpansionScaffold(lanes),
    reserveSleeveScaffold(),
    perpBasisScaffold(),
  ].sort((left, right) => left.rank - right.rank || String(left.id).localeCompare(String(right.id)));
  const topScaffold = scaffolds[0] || null;
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      scaffoldCount: scaffolds.length,
      leverageCount: scaffolds.filter((item) => item.leverage).length,
      statusCounts: countBy(scaffolds, (item) => item.status || "unknown"),
      topScaffoldId: topScaffold?.id || null,
      nextAction: topScaffold?.nextAction || null,
    },
    scaffolds,
  };
}

export function summarizeSecondaryStrategyScaffolds(report = null) {
  if (!report) return null;
  const topScaffold =
    report.scaffolds?.find((item) => item.id === report.summary?.topScaffoldId) ||
    report.scaffolds?.[0] ||
    null;
  return {
    scaffoldCount: report.summary?.scaffoldCount ?? 0,
    leverageCount: report.summary?.leverageCount ?? 0,
    statusCounts: report.summary?.statusCounts || {},
    topScaffold: topScaffold
      ? {
          id: topScaffold.id || null,
          label: topScaffold.label || null,
          status: topScaffold.status || null,
        }
      : null,
    nextAction: report.summary?.nextAction || null,
  };
}
