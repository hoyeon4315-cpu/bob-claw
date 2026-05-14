import { isOfficialGatewayDestinationChain, canonicalGatewayChain } from "../config/gateway-destinations.mjs";
import { computeTinyCanaryMinProfitablePositionUsd } from "../config/sizing.mjs";
import { getStrategyCaps } from "../config/strategy-caps.mjs";
import { evaluateIntentPolicies } from "../executor/policy/index.mjs";
import { resolveKillSwitchPath } from "../executor/policy/kill-switch.mjs";

export const ALL_SOURCE_DEPLOYMENT_SOURCES = Object.freeze([
  "pendle",
  "defillama",
  "merkl",
  "tokenized_gold_reserve",
  "stable_carry",
  "btc_wrapper_lending",
  "radar_campaign",
  "strategy_catalog",
]);

const SOURCE_PRIORITY = new Map(ALL_SOURCE_DEPLOYMENT_SOURCES.map((source, index) => [source, index]));

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 6) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(array(values).filter(Boolean).map(String))];
}

function first(value, fallback = null) {
  return array(value).find((item) => item !== null && item !== undefined) ?? fallback;
}

function normalizeChain(chain) {
  return canonicalGatewayChain(chain) || "unknown";
}

function capResultFor({ strategyId, chain, notionalUsd, activeCapitalUsd = null }) {
  const caps = getStrategyCaps(strategyId, { activeCapitalUsd });
  if (!caps) {
    return {
      status: "blocked",
      strategyId,
      blockers: ["strategy_caps_missing"],
      caps: null,
    };
  }
  const blockers = [];
  const perTxUsd = finiteNumber(caps.caps?.tinyLivePerTxUsd, finiteNumber(caps.caps?.perTxUsd));
  const perDayUsd = finiteNumber(caps.caps?.perDayUsd);
  const perChainUsd = finiteNumber(caps.caps?.perChainUsd?.[chain]);
  const maxDailyLossUsd = finiteNumber(caps.caps?.maxDailyLossUsd);
  if (caps.autoExecute !== true) blockers.push("strategy_auto_execute_not_enabled");
  if (perTxUsd !== null && finiteNumber(notionalUsd, 0) > perTxUsd) blockers.push("notional_above_per_tx_cap");
  if (perChainUsd !== null && finiteNumber(notionalUsd, 0) > perChainUsd) blockers.push("notional_above_per_chain_cap");
  if (perDayUsd === null) blockers.push("per_day_cap_missing");
  if (maxDailyLossUsd === null) blockers.push("max_daily_loss_cap_missing");
  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    strategyId,
    blockers,
    caps: {
      perTxUsd,
      perDayUsd,
      perChainUsd,
      maxDailyLossUsd,
      tinyLivePerTxUsd: finiteNumber(caps.caps?.tinyLivePerTxUsd),
    },
    effectiveCapSource: caps.effectiveCapSource || null,
  };
}

function emptyBinding(status = "missing", details = {}) {
  return { status, ready: status === "ready" || status === "binding_ready", ...details };
}

function receiptCapitalAuditPathFor(candidate) {
  return {
    capitalAuditRequired: true,
    preTradeSnapshot: "capital-audit:pre-intent",
    postBroadcastReconciliation: "receipt-ingest:post-broadcast-capital-delta",
    receiptIngestor: "src/cli/ingest-execution-receipt.mjs",
    reconciliation: "src/cli/reconcile-receipt.mjs",
    intentHashKey: "intentHash",
    strategyId: candidate.strategyId,
    opportunityId: candidate.opportunityId,
  };
}

function makeCandidate(fields, { activeCapitalUsd = null } = {}) {
  const chain = normalizeChain(fields.chain);
  const expectedGrossYieldUsd = round(fields.expectedGrossYieldUsd);
  const costUsd = round(fields.refillBridgeGasSlippageClaimSwapExitCostUsd);
  const hasCostEvidence = costUsd !== null || finiteNumber(fields.p90CostFloorUsd) !== null;
  const p90CostFloorUsd = hasCostEvidence
    ? round(Math.max(finiteNumber(costUsd, 0), finiteNumber(fields.p90CostFloorUsd, 0)))
    : null;
  const expectedRealizedNetUsd =
    finiteNumber(fields.expectedRealizedNetUsd) !== null
      ? round(fields.expectedRealizedNetUsd)
      : expectedGrossYieldUsd === null || p90CostFloorUsd === null
        ? null
        : round(expectedGrossYieldUsd - p90CostFloorUsd);
  const blockers = unique([
    ...array(fields.blockers),
    !isOfficialGatewayDestinationChain(chain) ? "chain_not_official_gateway_destination" : null,
    expectedRealizedNetUsd !== null && expectedRealizedNetUsd <= 0 ? "ev_not_positive" : null,
  ]);
  const candidate = {
    source: fields.source,
    strategyId: fields.strategyId || null,
    chain,
    asset: fields.asset || null,
    protocol: fields.protocol || null,
    opportunityId: fields.opportunityId || `${fields.source}:${chain}:${fields.protocol || "unknown"}`,
    executorBinding: fields.executorBinding || emptyBinding("missing"),
    routeRefillBinding: fields.routeRefillBinding || emptyBinding("missing"),
    notionalUsd: round(fields.notionalUsd),
    holdPeriodDays: round(fields.holdPeriodDays, 4),
    expectedGrossYieldUsd,
    rewardHaircut: round(fields.rewardHaircut, 4),
    refillBridgeGasSlippageClaimSwapExitCostUsd: costUsd,
    p90CostFloorUsd,
    expectedRealizedNetUsd,
    capResult: { status: "blocked", blockers: ["strategy_id_missing"], caps: null },
    policyResult: null,
    signerIntentAvailability: { ready: false, reason: "policy_not_attempted" },
    receiptCapitalAuditPath: null,
    exactBlockers: blockers,
    blockers,
    metadata: fields.metadata || {},
  };
  candidate.capResult = candidate.strategyId
    ? capResultFor({ strategyId: candidate.strategyId, chain, notionalUsd: candidate.notionalUsd, activeCapitalUsd })
    : candidate.capResult;
  candidate.receiptCapitalAuditPath = receiptCapitalAuditPathFor(candidate);
  return candidate;
}

function campaignByOpportunity(campaignAware = {}) {
  const map = new Map();
  for (const candidate of array(campaignAware.candidates)) {
    if (candidate?.opportunityId) map.set(String(candidate.opportunityId), candidate);
  }
  return map;
}

function merklOpportunityById(merklOpportunities = {}) {
  const map = new Map();
  for (const key of ["opportunities", "candidates", "topCandidates", "items"]) {
    for (const opportunity of array(merklOpportunities[key])) {
      const id = opportunity?.opportunityId ?? opportunity?.id;
      if (id !== null && id !== undefined) map.set(String(id), opportunity);
    }
  }
  return map;
}

function findLiveInventoryToken({ capitalManagerRefill = {}, chain, asset, tokenAddress }) {
  const targetChain = normalizeChain(chain);
  const targetAsset = String(asset || "").toLowerCase();
  const targetAddress = tokenAddress ? String(tokenAddress).toLowerCase() : null;
  const tokenRows = [
    ...array(capitalManagerRefill.capitalPlan?.inventory?.tokens),
    ...array(capitalManagerRefill.inventory?.tokens),
    ...array(capitalManagerRefill.fundingSourcePlan?.inventory?.tokens),
  ];
  return tokenRows.find((row) => {
    const rowChain = normalizeChain(row?.chain);
    const rowTicker = String(row?.ticker || row?.symbol || row?.asset || "").toLowerCase();
    const rowAddress = row?.token || row?.address ? String(row.token || row.address).toLowerCase() : null;
    if (rowChain !== targetChain) return false;
    if (targetAddress && rowAddress === targetAddress) return true;
    return targetAsset && rowTicker === targetAsset;
  });
}

function liveInventoryProof({ capitalManagerRefill, chain, asset, tokenAddress, requiredUsd }) {
  const row = findLiveInventoryToken({ capitalManagerRefill, chain, asset, tokenAddress });
  if (!row) return { ready: false, status: "missing", reason: "live_inventory_entry_asset_not_found" };
  const estimatedUsd = finiteNumber(row.estimatedUsd, finiteNumber(row.valueUsd));
  const staleFallback = row.staleFallback === true || row.status === "stale_fallback";
  if (staleFallback || row.scanError) {
    return {
      ready: false,
      status: "blocked",
      reason: row.scanError ? "live_inventory_scan_error" : "live_inventory_stale_fallback",
      rowStatus: row.status || null,
      estimatedUsd,
    };
  }
  return {
    ready: estimatedUsd !== null && estimatedUsd >= finiteNumber(requiredUsd, 0),
    status: estimatedUsd !== null && estimatedUsd >= finiteNumber(requiredUsd, 0) ? "ready" : "insufficient",
    reason:
      estimatedUsd !== null && estimatedUsd >= finiteNumber(requiredUsd, 0)
        ? null
        : "live_inventory_below_required_notional",
    chain: normalizeChain(row.chain),
    asset: row.ticker || row.symbol || row.asset || asset,
    token: row.token || row.address || tokenAddress || null,
    estimatedUsd: round(estimatedUsd),
    actualDecimal: round(row.actualDecimal),
    rowStatus: row.status || null,
    staleFallback: row.staleFallback === true,
    scanError: row.scanError || null,
  };
}

function rewardTokenTypesFor({ merklOpportunity = {}, campaign = {} }) {
  return unique([
    ...array(merklOpportunity.rewardTokenTypes),
    campaign.rewardTokenType,
    ...array(campaign.rewardTokenTypes),
  ]).map((value) => String(value).toLowerCase());
}

function rewardTokensFor({ merklOpportunity = {}, campaign = {} }) {
  return unique([
    campaign.rewardToken,
    ...array(campaign.rewardTokens),
    ...array(merklOpportunity.rewardTokenSymbols),
    ...array(merklOpportunity.rewardTokens),
  ]);
}

function rewardExitProofFor({ merklOpportunity = {}, campaign = {} }) {
  const rewardTokens = rewardTokensFor({ merklOpportunity, campaign });
  const rewardTokenTypes = rewardTokenTypesFor({ merklOpportunity, campaign });
  const campaignStatus = campaign.rewardExitLiquidityStatus || null;
  const hasReward = rewardTokens.length > 0 && rewardTokens.some((token) => !/^unknown$/i.test(token));
  const stableOrNative =
    !hasReward ||
    rewardTokenTypes.some((type) => /stable|native|shareprice|share_price|nativeorsharepriceyield/.test(type)) ||
    rewardTokens.every((token) => /^(usdc|usdt|dai|usds|lusd|frax|susdc)$/i.test(token));
  if (stableOrNative) {
    return {
      ready: true,
      status: hasReward ? "stable_or_native_reward_exit_exempt" : "native_or_share_price_yield_exit_exempt",
      reason: null,
      rewardTokens,
      rewardTokenTypes,
    };
  }
  if (rewardTokenTypes.some((type) => /pretge|pre_tge|points/.test(type))) {
    return {
      ready: false,
      status: "failed",
      blocker: "reward_exit_liquidity_failed:pre_tge_reward_token",
      reason: "pre_tge_reward_has_no_claim_swap_depth_route",
      rewardTokens,
      rewardTokenTypes,
      evidenceSource: "merkl_opportunity.rewardTokenTypes",
    };
  }
  if (campaignStatus?.ready === true) {
    return { ...campaignStatus, ready: true, rewardTokens, rewardTokenTypes };
  }
  return {
    ready: false,
    status: "missing_explicit_reward_exit_liquidity_proof",
    blocker: "reward_exit_liquidity_unproven",
    reason: campaignStatus?.reason || "non_stable_reward_requires_depth_proof",
    rewardTokens,
    rewardTokenTypes,
  };
}

function rewardHaircutFor({ campaign = {}, rewardExitProof }) {
  const configuredHaircut = finiteNumber(campaign.rewardTokenHaircut, 0);
  const rewardTokenTypes = array(rewardExitProof?.rewardTokenTypes);
  if (rewardTokenTypes.some((type) => /pretge|pre_tge|points/.test(type))) {
    return Math.max(configuredHaircut, 0.85);
  }
  return configuredHaircut;
}

function expectedGrossUsd({ notionalUsd, aprPct, holdDays }) {
  const notional = finiteNumber(notionalUsd);
  const apr = finiteNumber(aprPct);
  const days = finiteNumber(holdDays);
  if (notional === null || apr === null || days === null) return null;
  return (notional * apr * days) / 36500;
}

function maxTinyCanaryNotionalUsd({ strategyId, chain, activeCapitalUsd }) {
  const caps = getStrategyCaps(strategyId, { activeCapitalUsd });
  if (!caps?.caps) return null;
  const values = [
    finiteNumber(caps.caps.tinyLivePerTxUsd),
    finiteNumber(caps.caps.perTxUsd),
    finiteNumber(caps.caps.perChainUsd?.[normalizeChain(chain)]),
  ].filter((value) => value !== null);
  return values.length ? Math.min(...values) : null;
}

function removeResolvedMerklBlockers(blockers, { inventoryReady, rewardExitProofReady, rewardExitProofStatus }) {
  return unique(blockers).filter((blocker) => {
    if (inventoryReady && /inventory|current_inventory_entry_route_required/.test(blocker)) return false;
    if (blocker === "reward_exit_liquidity_unproven" && (rewardExitProofReady || rewardExitProofStatus === "failed")) {
      return false;
    }
    if (/tiny_canary_unprofitable:/.test(blocker)) return false;
    return true;
  });
}

function resizeTinyCanary({
  strategyId,
  chain,
  notionalUsd,
  displayedApr,
  rewardHaircut,
  holdDays,
  costUsd,
  inventoryProof,
  activeCapitalUsd,
}) {
  const effectiveApr = finiteNumber(displayedApr, 0) * (1 - finiteNumber(rewardHaircut, 0));
  const neededUsd = computeTinyCanaryMinProfitablePositionUsd({
    chain,
    aprPct: effectiveApr,
    expectedHoldDays: holdDays,
    estimatedGasCostUsd: costUsd,
  });
  if (neededUsd === null) return { notionalUsd, blocker: "tiny_canary_ev_unmeasured", neededUsd: null };
  if (finiteNumber(notionalUsd, 0) >= neededUsd) return { notionalUsd, neededUsd, resized: false };
  const capUsd = maxTinyCanaryNotionalUsd({ strategyId, chain, activeCapitalUsd });
  const roundedNeededUsd = Math.ceil(neededUsd);
  if (capUsd !== null && roundedNeededUsd > capUsd) {
    return {
      notionalUsd,
      neededUsd,
      capUsd,
      resized: false,
      blocker: `tiny_canary_resize_above_cap:need_$${roundedNeededUsd}_cap_$${Math.floor(capUsd)}`,
    };
  }
  if (inventoryProof?.ready === true && finiteNumber(inventoryProof.estimatedUsd, 0) < roundedNeededUsd) {
    return {
      notionalUsd,
      neededUsd,
      capUsd,
      resized: false,
      blocker: `tiny_canary_resize_inventory_short:need_$${roundedNeededUsd}_available_$${Math.floor(
        finiteNumber(inventoryProof.estimatedUsd, 0),
      )}`,
    };
  }
  return {
    notionalUsd: roundedNeededUsd,
    neededUsd,
    capUsd,
    resized: true,
    resizeReason: `tiny_canary_resized_to_min_profitable_notional_$${roundedNeededUsd}`,
  };
}

function normalizeMerklCandidates({
  merklQueue = {},
  merklOpportunities = {},
  campaignAware = {},
  capitalManagerRefill = {},
  activeCapitalUsd = null,
}) {
  const campaigns = campaignByOpportunity(campaignAware);
  const opportunities = merklOpportunityById(merklOpportunities);
  return array(merklQueue.queue).map((item) => {
    const campaign = campaigns.get(String(item.opportunityId)) || {};
    const merklOpportunity = opportunities.get(String(item.opportunityId)) || {};
    const strategyId = item.mappedStrategyId || campaign.strategyId || "gateway_native_asset_conversion_sleeve";
    const chain = item.chain || campaign.chain;
    const asset = first(item.entryAssets) || campaign.asset || campaign.rewardToken || "unknown";
    const assetAddress =
      item.protocolBindingPlan?.resolvedBinding?.assetAddress || merklOpportunity.protocolBinding?.assetAddress || null;
    const initialNotionalUsd = campaign.operatorPositionUsd ?? item.notionalUsd ?? 0;
    const inventoryProof = liveInventoryProof({
      capitalManagerRefill,
      chain,
      asset,
      tokenAddress: assetAddress,
      requiredUsd: initialNotionalUsd,
    });
    const rewardExitProof = rewardExitProofFor({ merklOpportunity, campaign });
    const rewardHaircut = rewardHaircutFor({ campaign, rewardExitProof });
    const holdPeriodDays =
      campaign.expectedHoldDays ??
      (finiteNumber(item.campaignRemainingHours) === null ? null : item.campaignRemainingHours / 24);
    const costs = finiteNumber(
      campaign.estimatedGasClaimSwapBridgeCostUsd,
      finiteNumber(campaign.tinyCanaryEvStatus?.roundTripCostUsd, 0),
    );
    const displayedApr = finiteNumber(campaign.displayedApr, finiteNumber(item.aprPct, 0));
    const resize = resizeTinyCanary({
      strategyId,
      chain,
      notionalUsd: initialNotionalUsd,
      displayedApr,
      rewardHaircut,
      holdDays: holdPeriodDays,
      costUsd: costs,
      inventoryProof,
      activeCapitalUsd,
    });
    const notionalUsd = resize.notionalUsd;
    const effectiveAprPct = displayedApr * (1 - rewardHaircut);
    const grossUsd = expectedGrossUsd({ notionalUsd, aprPct: effectiveAprPct, holdDays: holdPeriodDays });
    const expectedNetUsd = grossUsd === null ? campaign.expectedNetProfitUsd : grossUsd - finiteNumber(costs, 0);
    const blockers = removeResolvedMerklBlockers(
      [
        ...array(item.autoEntry?.blockers),
        ...array(campaign.blockers),
        item.executionReadiness?.status && item.executionReadiness.status !== "inventory_ready"
          ? item.executionReadiness.status
          : null,
        item.protocolBindingPlan?.status && item.protocolBindingPlan.status !== "binding_ready"
          ? item.protocolBindingPlan.status
          : null,
        rewardExitProof.ready === false ? rewardExitProof.blocker || "reward_exit_liquidity_unproven" : null,
        resize.blocker || null,
      ],
      {
        inventoryReady: inventoryProof.ready === true,
        rewardExitProofReady: rewardExitProof.ready === true,
        rewardExitProofStatus: rewardExitProof.status || null,
      },
    );
    return makeCandidate(
      {
        source: "merkl",
        strategyId,
        chain,
        asset,
        protocol: item.protocolId || campaign.protocol,
        opportunityId: item.opportunityId || item.queueId,
        executorBinding: {
          status: item.executionReadiness?.executorSupported === true ? "ready" : "missing",
          ready: item.executionReadiness?.executorSupported === true,
          executionReadiness:
            inventoryProof.ready === true ? "inventory_ready" : item.executionReadiness?.status || null,
          executionSurface: item.executionSurface || null,
        },
        routeRefillBinding: {
          status:
            inventoryProof.ready === true || item.executionReadiness?.status === "inventory_ready"
              ? "ready"
              : "inventory_or_refill_required",
          ready: inventoryProof.ready === true || item.executionReadiness?.status === "inventory_ready",
          capabilityGaps: inventoryProof.ready === true ? [] : array(item.capabilityGaps),
          inventoryProof,
        },
        notionalUsd,
        holdPeriodDays,
        expectedGrossYieldUsd: grossUsd ?? campaign.operatorExpectedGrossProfitUsd,
        rewardHaircut,
        refillBridgeGasSlippageClaimSwapExitCostUsd: costs,
        p90CostFloorUsd: campaign.tinyCanaryEvStatus?.roundTripCostUsd ?? costs,
        expectedRealizedNetUsd: expectedNetUsd,
        blockers,
        metadata: {
          queueId: item.queueId || null,
          rewardToken: first(rewardExitProof.rewardTokens) || campaign.rewardToken || null,
          rewardTokenTypes: rewardExitProof.rewardTokenTypes || [],
          rewardExitLiquidityStatus: campaign.rewardExitLiquidityStatus || null,
          rewardExitLiquidityProof: rewardExitProof,
          inventoryProof,
          tinyCanaryResize: resize,
          effectiveAprPct: round(effectiveAprPct, 4),
          family: item.family || null,
        },
      },
      { activeCapitalUsd },
    );
  });
}

function normalizeStableCarryCandidates({ merklCandidates = [], activeCapitalUsd = null }) {
  return merklCandidates
    .filter(
      (candidate) =>
        candidate.metadata?.family === "stable_treasury_carry" || /usdc|usdt|dai/i.test(candidate.asset || ""),
    )
    .map((candidate) =>
      makeCandidate(
        {
          ...candidate,
          source: "stable_carry",
          opportunityId: `stable-carry:${candidate.opportunityId}`,
          metadata: { linkedSource: "merkl", linkedOpportunityId: candidate.opportunityId },
          blockers: unique([
            ...candidate.blockers,
            candidate.receiptCapitalAuditPath?.capitalAuditRequired ? null : "receipt_path_missing",
          ]),
        },
        { activeCapitalUsd },
      ),
    );
}

function normalizeDefiLlamaCandidates({ defiLlamaPools = [], activeCapitalUsd = null }) {
  return array(defiLlamaPools)
    .slice(0, 50)
    .map((pool) => {
      const apy = finiteNumber(pool.apy, finiteNumber(pool.apyBase, 0));
      const notionalUsd = Math.min(25, finiteNumber(pool.tvlUsd, 0) > 0 ? 25 : 0);
      const grossUsd = round((notionalUsd * apy * 7) / 36500);
      return makeCandidate(
        {
          source: "defillama",
          strategyId: "defillama-yield-portfolio",
          chain: pool.chain,
          asset: String(pool.symbol || "unknown").split("-")[0],
          protocol: pool.project || pool.protocol || "unknown",
          opportunityId: pool.pool || pool.poolMeta || `${pool.chain}:${pool.project}:${pool.symbol}`,
          executorBinding: emptyBinding("missing", { reason: "defillama_surface_only" }),
          routeRefillBinding: emptyBinding("missing", { reason: "requires_bound_protocol_candidate" }),
          notionalUsd,
          holdPeriodDays: 7,
          expectedGrossYieldUsd: grossUsd,
          rewardHaircut: 0,
          refillBridgeGasSlippageClaimSwapExitCostUsd: null,
          p90CostFloorUsd: null,
          expectedRealizedNetUsd: null,
          blockers: ["defillama_requires_executable_protocol_binding", "unwind_path_missing", "receipt_path_missing"],
          metadata: { tvlUsd: finiteNumber(pool.tvlUsd), apy },
        },
        { activeCapitalUsd },
      );
    });
}

function normalizeBtcWrapperCandidates({ allocatorCore = {}, activeCapitalUsd = null }) {
  return array(allocatorCore.candidates)
    .filter((candidate) => /btc|wrapped/i.test(`${candidate.id || ""} ${candidate.assetFamily || ""}`))
    .map((candidate) =>
      makeCandidate(
        {
          source: "btc_wrapper_lending",
          strategyId: candidate.id,
          chain: candidate.chain || "base",
          asset: candidate.asset || candidate.assetFamily || "wrapped_btc",
          protocol: first(candidate.protocols) || candidate.protocol || "unknown",
          opportunityId: candidate.id,
          executorBinding: emptyBinding(candidate.executorBindingReady ? "ready" : "missing"),
          routeRefillBinding: emptyBinding(candidate.routeReady ? "ready" : "missing"),
          notionalUsd: candidate.notionalUsd || 0,
          holdPeriodDays: candidate.holdPeriodDays || null,
          expectedGrossYieldUsd: candidate.expectedGrossYieldUsd ?? null,
          refillBridgeGasSlippageClaimSwapExitCostUsd: candidate.totalCostUsd ?? null,
          expectedRealizedNetUsd: candidate.expectedRealizedNetUsd ?? null,
          blockers: array(candidate.blockers),
          metadata: { score: candidate.score ?? null },
        },
        { activeCapitalUsd },
      ),
    );
}

function normalizeRadarCandidates({ radarBoard = {}, activeCapitalUsd = null }) {
  return array(radarBoard.candidates).map((candidate) =>
    makeCandidate(
      {
        source: "radar_campaign",
        strategyId: candidate.strategyId || candidate.boundStrategyId,
        chain: candidate.chain || candidate.destinationChain,
        asset: candidate.asset || first(candidate.entryAssets) || "unknown",
        protocol: candidate.protocol || candidate.protocolId || "unknown",
        opportunityId: candidate.id || candidate.opportunityId,
        executorBinding: emptyBinding(candidate.executionPath ? "ready" : "missing", {
          executionPath: candidate.executionPath || null,
        }),
        routeRefillBinding: emptyBinding(candidate.routeReady ? "ready" : "missing"),
        notionalUsd: candidate.notionalUsd || candidate.tinyLivePerTxUsd || 0,
        holdPeriodDays: candidate.expectedHoldDays || null,
        expectedGrossYieldUsd: candidate.expectedGrossYieldUsd ?? candidate.expectedRewardUsd ?? null,
        rewardHaircut: candidate.rewardHaircut ?? null,
        refillBridgeGasSlippageClaimSwapExitCostUsd: candidate.totalCostUsd ?? candidate.p90CostFloorUsd ?? null,
        p90CostFloorUsd: candidate.p90CostFloorUsd ?? null,
        expectedRealizedNetUsd: candidate.expectedRealizedNetUsd ?? candidate.expectedNetUsd ?? null,
        blockers: array(candidate.blockers),
        metadata: { calibrationStatus: candidate.calibrationStatus || null },
      },
      { activeCapitalUsd },
    ),
  );
}

function normalizeStrategyCatalogCandidates({ strategyCatalog = {}, executionSurfaces = {}, activeCapitalUsd = null }) {
  const surfaceById = new Map(array(executionSurfaces.strategies).map((strategy) => [strategy.id, strategy]));
  const rows = [
    ...array(strategyCatalog.btcFamilies),
    ...array(strategyCatalog.ethBranches),
    ...array(strategyCatalog.entries),
    ...array(strategyCatalog.strategies),
  ];
  return rows.map((row) => {
    const surface = surfaceById.get(row.id) || {};
    return makeCandidate(
      {
        source: "strategy_catalog",
        strategyId: row.id,
        chain: row.chain || row.destinationChain || first(row.chains) || "base",
        asset: row.asset || row.assetFamily || "unknown",
        protocol: row.protocol || first(row.protocols) || row.family || "catalog",
        opportunityId: row.id,
        executorBinding: emptyBinding(surface.currentLiveEligible ? "ready" : "missing", {
          currentLiveEligible: surface.currentLiveEligible === true,
        }),
        routeRefillBinding: emptyBinding(row.routeReady ? "ready" : "missing"),
        notionalUsd: row.notionalUsd || 0,
        holdPeriodDays: row.holdPeriodDays || null,
        expectedGrossYieldUsd: row.expectedGrossYieldUsd ?? row.evidence?.expectedGrossYieldUsd ?? null,
        refillBridgeGasSlippageClaimSwapExitCostUsd: row.totalCostUsd ?? row.evidence?.roundTripCostUsd ?? null,
        expectedRealizedNetUsd: row.expectedRealizedNetUsd ?? null,
        blockers: unique([
          ...array(row.blockers),
          ...array(surface.liveAdmissionBlockers),
          row.status && row.status !== "live" ? row.status : null,
        ]),
        metadata: { label: row.label || null, catalogStatus: row.status || null },
      },
      { activeCapitalUsd },
    );
  });
}

function normalizeGoldReserveCandidates({ strategyCatalog = {}, merklCandidates = [], activeCapitalUsd = null }) {
  const catalogRows = [
    ...array(strategyCatalog.btcFamilies),
    ...array(strategyCatalog.entries),
    ...array(strategyCatalog.strategies),
  ].filter((row) => /gold|reserve/i.test(`${row.id || ""} ${row.label || ""} ${row.family || ""}`));
  const fromCatalog = catalogRows.map((row) =>
    makeCandidate(
      {
        source: "tokenized_gold_reserve",
        strategyId: row.id || "tokenized_reserve_sleeve",
        chain: row.chain || first(row.chains) || "ethereum",
        asset: row.asset || "tokenized_gold_or_reserve",
        protocol: row.protocol || first(row.protocols) || "registry_required",
        opportunityId: row.id || "tokenized_gold_reserve",
        executorBinding: emptyBinding("missing", { reason: "committed_registry_and_unwind_required" }),
        routeRefillBinding: emptyBinding("missing", { reason: "measured_btc_return_path_required" }),
        notionalUsd: row.notionalUsd || 0,
        expectedGrossYieldUsd: row.expectedGrossYieldUsd ?? null,
        refillBridgeGasSlippageClaimSwapExitCostUsd: row.totalCostUsd ?? row.evidence?.roundTripCostUsd ?? null,
        expectedRealizedNetUsd: row.expectedRealizedNetUsd ?? null,
        blockers: unique([
          ...array(row.blockers),
          "committed_registry_approval_required",
          "deterministic_unwind_required",
          "measured_btc_return_path_required",
        ]),
        metadata: { label: row.label || null },
      },
      { activeCapitalUsd },
    ),
  );
  const fromMerkl = merklCandidates
    .filter((candidate) =>
      /reserve|gold/i.test(`${candidate.strategyId || ""} ${candidate.asset || ""} ${candidate.protocol || ""}`),
    )
    .map((candidate) =>
      makeCandidate(
        {
          ...candidate,
          source: "tokenized_gold_reserve",
          opportunityId: `tokenized-reserve:${candidate.opportunityId}`,
          blockers: unique([
            ...candidate.blockers,
            "committed_registry_approval_required",
            "deterministic_unwind_required",
            "measured_btc_return_path_required",
          ]),
        },
        { activeCapitalUsd },
      ),
    );
  return [...fromCatalog, ...fromMerkl];
}

function normalizePendleCandidates({ pendleCandidates = [], strategyCatalog = {}, activeCapitalUsd = null }) {
  const explicit = array(pendleCandidates);
  const catalog = [
    ...array(strategyCatalog.btcFamilies),
    ...array(strategyCatalog.entries),
    ...array(strategyCatalog.strategies),
  ].filter((row) => /pendle/i.test(`${row.id || ""} ${row.label || ""} ${row.protocol || ""}`));
  return [...explicit, ...catalog].map((row) =>
    makeCandidate(
      {
        source: "pendle",
        strategyId: row.strategyId || row.id || "pendle-yield-tokenization",
        chain: row.chain || first(row.chains) || "base",
        asset: row.asset || row.entryAsset || first(row.entryAssets) || "pt_or_yt",
        protocol: row.protocol || "pendle",
        opportunityId: row.opportunityId || row.id || row.market || "pendle",
        executorBinding: emptyBinding(row.executorReady ? "ready" : "missing", { market: row.market || null }),
        routeRefillBinding: emptyBinding(row.routeReady ? "ready" : "missing"),
        notionalUsd: row.notionalUsd || 0,
        holdPeriodDays: row.holdPeriodDays || row.daysToMaturity || null,
        expectedGrossYieldUsd: row.expectedGrossYieldUsd ?? row.fixedYieldUsd ?? null,
        rewardHaircut: row.rewardHaircut ?? null,
        refillBridgeGasSlippageClaimSwapExitCostUsd: row.totalCostUsd ?? row.exitCostUsd ?? null,
        p90CostFloorUsd: row.p90CostFloorUsd ?? null,
        expectedRealizedNetUsd: row.expectedRealizedNetUsd ?? null,
        blockers: array(row.blockers),
        metadata: { market: row.market || null, maturity: row.maturity || null },
      },
      { activeCapitalUsd },
    ),
  );
}

function buildIntent(candidate, now) {
  return {
    strategyId: candidate.strategyId,
    chain: candidate.chain,
    family: "evm",
    intentType: "all_source_deployment_candidate",
    executionReason: "all_source_deployment_selector",
    amountUsd: candidate.notionalUsd,
    expectedNetUsd: candidate.expectedRealizedNetUsd,
    observedAt: now,
    metadata: {
      source: candidate.source,
      opportunityId: candidate.opportunityId,
      protocol: candidate.protocol,
      protocolIds: candidate.protocol ? [candidate.protocol] : [],
      asset: candidate.asset,
      expectedGrossYieldUsd: candidate.expectedGrossYieldUsd,
      p90CostFloorUsd: candidate.p90CostFloorUsd,
      receiptCapitalAuditPath: candidate.receiptCapitalAuditPath,
      assetCoverage: { status: "ok", unknownAssetBalanceCount: 0, unknownAssetBalances: [] },
      tinyLiveCanary: true,
      exposureAction: "open",
    },
  };
}

function candidatePolicyEligible(candidate) {
  return (
    finiteNumber(candidate.expectedRealizedNetUsd) !== null &&
    candidate.expectedRealizedNetUsd > 0 &&
    candidate.capResult?.status === "ready" &&
    candidate.executorBinding?.ready === true &&
    candidate.routeRefillBinding?.ready === true &&
    candidate.receiptCapitalAuditPath?.capitalAuditRequired === true &&
    candidate.blockers.length === 0
  );
}

function candidateRank(left, right) {
  const rightNet = finiteNumber(right.expectedRealizedNetUsd, Number.NEGATIVE_INFINITY);
  const leftNet = finiteNumber(left.expectedRealizedNetUsd, Number.NEGATIVE_INFINITY);
  if (leftNet !== rightNet) return rightNet - leftNet;
  return (SOURCE_PRIORITY.get(left.source) ?? 99) - (SOURCE_PRIORITY.get(right.source) ?? 99);
}

function buildNoTradeTable(candidates) {
  const rows = candidates.map((candidate) => ({
    source: candidate.source,
    strategyId: candidate.strategyId,
    chain: candidate.chain,
    asset: candidate.asset,
    protocol: candidate.protocol,
    opportunityId: candidate.opportunityId,
    notionalUsd: candidate.notionalUsd,
    expectedGrossUsd: candidate.expectedGrossYieldUsd,
    totalCostUsd: candidate.p90CostFloorUsd,
    expectedRealizedNetUsd: candidate.expectedRealizedNetUsd,
    capStatus: candidate.capResult?.status || null,
    policyDecision: candidate.policyResult?.decision || null,
    blockers: unique([
      ...array(candidate.blockers),
      ...array(candidate.capResult?.blockers),
      ...array(candidate.policyResult?.blockers),
    ]),
  }));
  const seenSources = new Set(rows.map((row) => row.source));
  for (const source of ALL_SOURCE_DEPLOYMENT_SOURCES) {
    if (!seenSources.has(source)) {
      rows.push({
        source,
        strategyId: null,
        chain: null,
        asset: null,
        protocol: null,
        opportunityId: null,
        notionalUsd: null,
        expectedGrossUsd: null,
        totalCostUsd: null,
        expectedRealizedNetUsd: null,
        capStatus: null,
        policyDecision: null,
        blockers: [`${source}_candidate_missing`],
      });
    }
  }
  return rows;
}

function sourceCoverage(candidates) {
  return ALL_SOURCE_DEPLOYMENT_SOURCES.map((source) => {
    const rows = candidates.filter((candidate) => candidate.source === source);
    return {
      source,
      candidateCount: rows.length,
      evPositiveCount: rows.filter((candidate) => finiteNumber(candidate.expectedRealizedNetUsd, -1) > 0).length,
      policyAttemptedCount: rows.filter((candidate) => candidate.policyResult).length,
      topBlockers: unique(rows.flatMap((candidate) => candidate.blockers)).slice(0, 8),
    };
  });
}

function capitalUtilization({ capitalAudit = {}, unifiedCapital = {} }) {
  const totalUsd =
    unifiedCapital.halt === true
      ? finiteNumber(capitalAudit.summary?.currentNativeBtcUsd, 0)
      : finiteNumber(
          unifiedCapital.unifiedNavUsd,
          finiteNumber(
            capitalAudit.summary?.currentCombinedUsd,
            finiteNumber(capitalAudit.summary?.currentNativeBtcUsd, 0),
          ),
        );
  const productiveUsd = finiteNumber(capitalAudit.summary?.productiveUsd, 0);
  return {
    before: {
      totalUsd: round(totalUsd),
      productiveUsd: round(productiveUsd),
      idleUsd: round(Math.max(0, totalUsd - productiveUsd)),
      productiveRatio: totalUsd > 0 ? round(productiveUsd / totalUsd, 4) : null,
    },
    target: {
      productiveTargetRatio: 0.8,
      productiveTargetUsd: totalUsd > 0 ? round(totalUsd * 0.8) : null,
      idleReserveRatio: 0.2,
      idleReserveUsd: totalUsd > 0 ? round(totalUsd * 0.2) : null,
    },
  };
}

export async function buildAllSourceDeploymentSelectorReport(options = {}) {
  const now = options.now || new Date().toISOString();
  const activeCapitalUsd = finiteNumber(
    options.unifiedCapital?.unifiedNavUsd,
    finiteNumber(options.capitalAudit?.summary?.currentNativeBtcUsd),
  );
  const merklCandidates = normalizeMerklCandidates({ ...options, activeCapitalUsd });
  const candidates = [
    ...normalizePendleCandidates({ ...options, activeCapitalUsd }),
    ...normalizeDefiLlamaCandidates({ ...options, activeCapitalUsd }),
    ...merklCandidates,
    ...normalizeGoldReserveCandidates({ ...options, merklCandidates, activeCapitalUsd }),
    ...normalizeStableCarryCandidates({ merklCandidates, activeCapitalUsd }),
    ...normalizeBtcWrapperCandidates({ ...options, activeCapitalUsd }),
    ...normalizeRadarCandidates({ ...options, activeCapitalUsd }),
    ...normalizeStrategyCatalogCandidates({ ...options, activeCapitalUsd }),
  ];

  const policyEvaluator = options.policyEvaluator || evaluateIntentPolicies;
  const policyCandidates = candidates.filter(candidatePolicyEligible).sort(candidateRank);
  let selectedCandidate = null;
  let attemptedIntent = null;
  if (policyCandidates.length > 0) {
    selectedCandidate = policyCandidates[0];
    attemptedIntent = buildIntent(selectedCandidate, now);
    const policyResult = await policyEvaluator({
      intent: attemptedIntent,
      auditRecords: array(options.auditRecords),
      receiptRecords: array(options.receiptRecords),
      activeBudgetUsd: activeCapitalUsd,
      now,
      killSwitchPath: options.killSwitchPath || resolveKillSwitchPath(),
      riskContext: {
        totalOperatingCapitalUsd: activeCapitalUsd,
        operatingCapitalUsd: activeCapitalUsd,
        ...(options.riskContext || {}),
      },
      evCostModel: options.evCostModel || null,
      capitalAuditState: options.capitalAuditState || options.capitalAudit || null,
    });
    selectedCandidate = {
      ...selectedCandidate,
      policyResult,
      signerIntentAvailability: {
        ready: policyResult.decision === "ALLOW",
        reason: policyResult.decision === "ALLOW" ? null : first(policyResult.blockers, "policy_blocked"),
      },
    };
    const index = candidates.findIndex(
      (candidate) =>
        candidate.source === selectedCandidate.source && candidate.opportunityId === selectedCandidate.opportunityId,
    );
    if (index >= 0) candidates[index] = selectedCandidate;
  }

  const noTradeTable = buildNoTradeTable(candidates);
  const policyAttempted = selectedCandidate !== null;
  const noBroadcastReason = policyAttempted
    ? selectedCandidate.policyResult?.decision === "ALLOW"
      ? "selector_policy_attempt_only_no_signer_execute"
      : `policy_blocked:${first(selectedCandidate.policyResult?.blockers, "unknown")}`
    : "no_positive_ev_policy_eligible_candidate";

  return {
    generatedAt: now,
    status: policyAttempted ? "POLICY_ATTEMPTED" : "NO_TRADE",
    sourceCoverage: sourceCoverage(candidates),
    capitalTruth: {
      capitalAuditGeneratedAt: options.capitalAudit?.generatedAt || null,
      currentNativeBtcSats: options.capitalAudit?.summary?.currentNativeBtcSats ?? null,
      currentNativeBtcUsd: options.capitalAudit?.summary?.currentNativeBtcUsd ?? null,
      unifiedCapitalHalt: options.unifiedCapital?.halt ?? null,
      unifiedCapitalFlags: array(options.unifiedCapital?.flags),
      missingSources: array(options.unifiedCapital?.missingSources),
    },
    candidates,
    selection: {
      status: policyAttempted ? "POLICY_ATTEMPTED" : "NO_TRADE",
      selectedCandidate,
      attemptedIntent,
    },
    broadcast: {
      attempted: false,
      txHashes: [],
      noBroadcastReason,
    },
    noTradeTable,
    capitalUtilization: capitalUtilization(options),
  };
}
