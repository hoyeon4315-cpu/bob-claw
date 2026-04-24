// P2 — New strategy candidate parity floor slice.
//
// Exposes every strategy candidate (existing + new) with the same maturity
// schema so the dashboard can compare them side-by-side.
//
import { getStrategyCaps } from "../config/strategy-caps.mjs";

// Pure function. No I/O.

const NEW_CANDIDATE_IDS = Object.freeze([
  "wrapped-btc-loop-base-moonwell",
  "recursive_wrapped_btc_lending_loop",
  "gateway-btc-onramp",
  "gateway-btc-offramp",
  "gateway-btc-funding-transfer",
  "proxy-spread-experiment",
  "token-dex-experiment",
  "native-dex-experiment",
  "gas-zip-native-refuel",
  "wrapper-btc-arbitrage",
  "beefy-folding-vault",
  "pendle-pt-lbtc-base",
  "aerodrome-cl-base",
  "pendle-pt-solvbtc-bbn-bsc",
  "berachain-bend-bex-bgt",
  "gmx-v2-perp-basis-avax",
  "stablecoin_spread_loop",
  "proxy_spread_expansion",
  "tokenized_reserve_sleeve",
  "gateway_native_asset_conversion_sleeve",
  "recursive_stablecoin_lending_loop",
  "destination_wrapped_btc_rotation",
  "stablecoin_treasury_rotation",
  "gateway_proxy_spread_rebalance_recheck",
  "macro_asset_rotation",
  "eth_destination_deployment",
  "onchain_btc_perp_basis",
]);

function resolveFromDeterministic(candidates, id) {
  const c = candidates?.find((x) => x.id === id);
  if (!c) return null;
  return {
    strategyId: c.id,
    chainSet: c.protocolTrack?.chains || ["base"],
    adapterTickConnected:
      c.deterministicStatus === "repo_auto_build_supported" ||
      c.deterministicStatus === "planning_adapter_ready",
    marketLoader: Boolean(c.protocolAdapterId),
    receiptSchema: Boolean(c.dryRunReceiptRecorded),
    microCanaryStatus: c.readyForLive
      ? "micro_canary_ready"
      : c.dryRunReceiptRecorded
        ? "minimal_live_proof_exists"
        : "not_started",
    promotionVerdict:
      c.status === "receipt_backed_validation_ready"
        ? "live_candidate"
        : c.status === "dry_run_evidence_recorded"
          ? "shadow_ready"
          : "blocked",
    demotionSummary: { demoted: false, triggers: [] },
    topBlocker: c.blockers?.[0] || null,
    blockers: c.blockers || [],
    maturity: c.status || "unknown",
    source: "deterministic_candidate",
  };
}

function resolveFromScaffold(scaffolds, id) {
  const s = scaffolds?.find((x) => x.id === id);
  if (!s) return null;
  return {
    strategyId: s.id,
    chainSet: s.protocolTrack?.chains || ["base"],
    adapterTickConnected: false,
    marketLoader: Boolean(s.protocolTrack?.protocols?.length),
    receiptSchema: false,
    microCanaryStatus: "not_started",
    promotionVerdict: "blocked",
    demotionSummary: { demoted: false, triggers: [] },
    topBlocker: s.blockers?.[0] || "design_scaffold_incomplete",
    blockers: s.blockers || ["design_scaffold_incomplete"],
    maturity: s.status || "design_scaffold",
    source: "secondary_scaffold",
  };
}

function resolveFromResearch(board, id) {
  const c = board?.find((x) => x.id === id);
  if (!c) return null;
  return {
    strategyId: c.id,
    chainSet: c.evidence?.arrivalFamily === "wrapped_btc" ? ["base"] : ["base"],
    adapterTickConnected: c.evidence?.executionSupportStatus === "repo_auto_build_supported",
    marketLoader: Boolean(c.protocolAdapterId),
    receiptSchema: Boolean(c.evidence?.dryRunReceiptRecorded),
    microCanaryStatus: c.evidence?.signerBackedRunCount > 0
      ? "minimal_live_proof_exists"
      : c.evidence?.dryRunReceiptRecorded
        ? "micro_canary_ready"
        : "not_started",
    promotionVerdict:
      c.status === "receipt_backed_validation_ready"
        ? "live_candidate"
        : c.status === "dry_run_evidence_recorded"
          ? "shadow_ready"
          : "blocked",
    demotionSummary: { demoted: false, triggers: [] },
    topBlocker: c.missingEvidence?.[0] || c.blockers?.[0] || null,
    blockers: [...(c.blockers || []), ...(c.missingEvidence || [])],
    maturity: c.status || "research_backlog",
    source: "research_board",
  };
}

function resolveFromCaps(id) {
  const caps = getStrategyCaps(id);
  if (!caps) return null;
  const chains = Object.keys(caps.caps?.perChainUsd || {});
  const hasLeverage = Boolean(caps.leverage);
  return {
    strategyId: id,
    chainSet: chains.length > 0 ? chains : ["base"],
    adapterTickConnected: true,
    marketLoader: true,
    receiptSchema: false,
    microCanaryStatus: "not_started",
    promotionVerdict: caps.autoExecute ? "blocked" : "blocked",
    demotionSummary: { demoted: false, triggers: [] },
    topBlocker: "dry_run_receipt_missing",
    blockers: ["dry_run_receipt_missing"],
    maturity: "caps_configured",
    source: "caps_registry",
  };
}

function resolveFromTick(tickStatus, id) {
  const s = tickStatus?.strategies?.find((x) => x.strategyId === id);
  const stage = tickStatus?.strategyStage?.byStrategy?.[id];
  const micro = tickStatus?.microCanary?.byStrategy?.[id];
  if (!s && !stage && !micro) return null;
  const hasReceipts = (s?.receiptCountTotal ?? 0) > 0;
  const hasSignerBacked = (s?.receiptCountSignerBacked ?? 0) > 0;
  const baseVerdict = stage?.promotionVerdict || s?.lastTickMode || "blocked";
  const baseBlockers = s?.lastTickBlockers || [];
  // Remove dry_run_receipt_missing when receipts exist.
  const cleanedBlockers = hasReceipts
    ? baseBlockers.filter((b) => b !== "dry_run_receipt_missing")
    : baseBlockers;
  // If no tick record but receipts exist, promote to shadow_ready.
  const promotionVerdict =
    baseVerdict === "blocked" && !s?.lastTickAt && hasSignerBacked
      ? "shadow_ready"
      : baseVerdict;
  return {
    microCanaryStatus: micro?.microCanaryStatus || s?.microCanaryStatus || "not_started",
    promotionVerdict,
    demotionSummary: {
      demoted: s?.demotion?.demoted || false,
      triggers: s?.demotion?.triggers || [],
    },
    topBlocker: cleanedBlockers[0] || stage?.topBlocker || null,
    blockers: cleanedBlockers,
  };
}

function fallbackCandidate(id) {
  const chainMap = {
    recursive_stablecoin_lending_loop: ["base"],
    stablecoin_spread_loop: ["base"],
    proxy_spread_expansion: ["base", "ethereum"],
    tokenized_reserve_sleeve: ["bsc"],
    eth_destination_deployment: ["ethereum"],
    gateway_native_asset_conversion_sleeve: ["bob", "base"],
  };
  return {
    strategyId: id,
    chainSet: chainMap[id] || ["base"],
    adapterTickConnected: false,
    marketLoader: false,
    receiptSchema: false,
    microCanaryStatus: "not_started",
    promotionVerdict: "blocked",
    demotionSummary: { demoted: false, triggers: [] },
    topBlocker: "candidate_not_yet_built_in_repo",
    blockers: ["candidate_not_yet_built_in_repo"],
    maturity: "design_scaffold",
    source: "fallback_registry",
  };
}

export function buildStrategyParitySlice({
  deterministicCandidates = [],
  secondaryScaffolds = [],
  researchBoard = [],
  strategyTickStatus = null,
} = {}) {
  const det = deterministicCandidates?.candidates || deterministicCandidates || [];
  const scaff = secondaryScaffolds?.scaffolds || secondaryScaffolds || [];
  const research = researchBoard?.candidates || researchBoard || [];

  const allIds = [
    ...new Set([
      ...det.map((c) => c.id),
      ...scaff.map((s) => s.id),
      ...research.map((r) => r.id),
      ...NEW_CANDIDATE_IDS,
    ]),
  ];

  const rows = allIds.map((id) => {
    let row =
      resolveFromDeterministic(det, id) ||
      resolveFromScaffold(scaff, id) ||
      resolveFromResearch(research, id) ||
      resolveFromCaps(id) ||
      fallbackCandidate(id);

    const tick = resolveFromTick(strategyTickStatus, id);
    if (tick) {
      // Merge tick-derived blockers with row blockers, removing stale entries.
      const mergedBlockers = tick.blockers?.length > 0
        ? tick.blockers
        : row.blockers.filter((b) => b !== "dry_run_receipt_missing");
      row = {
        ...row,
        microCanaryStatus: tick.microCanaryStatus,
        promotionVerdict: tick.promotionVerdict,
        demotionSummary: tick.demotionSummary,
        topBlocker: tick.topBlocker || row.topBlocker,
        blockers: mergedBlockers,
      };
    }

    return Object.freeze(row);
  });

  return Object.freeze({
    candidateCount: rows.length,
    newCandidateCount: NEW_CANDIDATE_IDS.length,
    rows,
    byStrategy: Object.freeze(Object.fromEntries(rows.map((r) => [r.strategyId, r]))),
    generatedAt: new Date().toISOString(),
  });
}
