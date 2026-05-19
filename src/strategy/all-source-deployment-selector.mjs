import { isOfficialGatewayDestinationChain, canonicalGatewayChain } from "../config/gateway-destinations.mjs";
import { DESTINATION_REPRESENTATIVE_BINDINGS } from "../config/destination-representative-bindings.mjs";
import { MERKL_AUTO_ENTRY_POLICY } from "../config/merkl-auto-entry.mjs";
import { computeTinyCanaryMinProfitablePositionUsd, tinyCanarySameChainRoundTripCostUsd } from "../config/sizing.mjs";
import { getStrategyCaps } from "../config/strategy-caps.mjs";
import { buildFundingSourcePlan } from "../treasury/funding-source-planner.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { evaluateIntentPolicies } from "../executor/policy/index.mjs";
import { resolveKillSwitchPath } from "../executor/policy/kill-switch.mjs";
import {
  isSupportedBindingKind,
  resolveExitExecutor,
  resolveIntentType,
} from "../executor/protocol-binding-registry.mjs";
import { evaluatePendleYtEv } from "./pendle-yt-ev.mjs";
import { nextLegalCapitalAction } from "./next-legal-capital-action.mjs";
import { buildLifecycleEvidence } from "./lifecycle-evidence.mjs";
import { buildFamilyActionTable } from "./family-action-classification.mjs";
import { buildDryRunRemediationPlan } from "./dry-run-remediation-planner.mjs";
import { buildLaneHandlerReport } from "./lane-handler-framework.mjs";
import { buildLaneIntentCandidateReport } from "./remediation-lane-intent-candidate.mjs";

function attachLifecycleEvidence(candidates, options, now) {
  const protocolPositionMarks = Array.isArray(options.protocolPositionMarks) ? options.protocolPositionMarks : [];
  for (const candidate of candidates) {
    const { evidence: lifecycleEvidence } = buildLifecycleEvidence({
      candidate,
      protocolPositionMarks,
      pendleYtDryRun: options.pendleYtDryRun || null,
      pendleYtExitFromPosition: options.pendleYtExitFromPosition || null,
      merklUserRewards: options.merklUserRewards || null,
      walletAddress: options.walletAddress || null,
      now,
    });
    candidate.lifecycleEvidence = lifecycleEvidence;
  }
}

function attachNextLegalCapitalAction(candidates) {
  for (const candidate of candidates) {
    const mergedBlockers = [
      ...new Set([
        ...(Array.isArray(candidate.blockers) ? candidate.blockers : []),
        ...(Array.isArray(candidate.capResult?.blockers) ? candidate.capResult.blockers : []),
        ...(Array.isArray(candidate.policyResult?.blockers) ? candidate.policyResult.blockers : []),
      ]),
    ];
    candidate.nextLegalCapitalAction = nextLegalCapitalAction({
      blockers: mergedBlockers,
      capResult: candidate.capResult,
      expectedRealizedNetUsd: candidate.expectedRealizedNetUsd,
      lifecycleEvidence: candidate.lifecycleEvidence,
    });
  }
}

export const ALL_SOURCE_DEPLOYMENT_SOURCES = Object.freeze([
  "pendle",
  "defillama",
  "merkl",
  "tokenized_gold_reserve",
  "stable_carry",
  "btc_wrapper_lending",
  "radar_campaign",
  "aggressive_velocity",
  "strategy_catalog",
]);

const SOURCE_PRIORITY = new Map(ALL_SOURCE_DEPLOYMENT_SOURCES.map((source, index) => [source, index]));
const SELECTOR_TREASURY_POLICY = validateTreasuryPolicy(buildDefaultTreasuryPolicy());

export const DEPLOYMENT_SELECTOR_FAMILIES = Object.freeze([
  "pendle",
  "merkl",
  "defillama",
  "stable_carry",
  "btc_wrapper_lending",
  "tokenized_gold_reserve",
  "radar",
  "aggressive",
  "strategy_catalog",
  // Position marks whose strategyId/protocolId do not map to any of the strategy-universe
  // action lanes above land here instead of being silently bled into a lane via regex.
  // gateway_native_asset_conversion_sleeve / YO vault / NAV-only marks are the canonical
  // occupants — they have no strategy-universe action producer and must not pollute
  // merkl claim economics, pendle YT, stable_carry, or btc_wrapper_lending rows.
  "ambiguous_position_family",
]);

// Authoritative strategyId → family map. strategyId comes from the position producer
// itself (pendle YT canary, gateway sleeve, etc.) and is the only durable classifier
// for active marks. Regex over JSON.stringify(mark) historically bled USDC marks into
// stable_carry, "merkl:" prefix into merkl, etc.; this map removes that ambiguity.
const STRATEGY_ID_TO_MARK_FAMILY = Object.freeze({
  "pendle-yt-canary": "pendle",
  "pendle-direct-canary": "pendle",
  pendle_yt: "pendle",
  pendle: "pendle",
  gateway_native_asset_conversion_sleeve: "ambiguous_position_family",
});

// Fallback only when strategyId is absent. protocolId still does not disambiguate
// between strategy-universe lanes (morpho/yo serve multiple sleeves), so anything that
// reaches this fallback without a mapped strategyId remains ambiguous on purpose.
const PROTOCOL_ID_TO_MARK_FAMILY = Object.freeze({
  pendle: "pendle",
});

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
    signerIntentAvailability: fields.signerIntentAvailability || { ready: false, reason: "policy_not_attempted" },
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
    if (targetAddress) return rowAddress === targetAddress;
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

function liveInventoryProofForTokenSet({
  capitalManagerRefill,
  chain,
  asset,
  tokenAddress,
  alternativeTokenAddresses = [],
  requiredUsd,
} = {}) {
  const addresses = unique(
    [tokenAddress, ...array(alternativeTokenAddresses)].map((value) => String(value).toLowerCase()),
  );
  const proofs = addresses
    .map((address) =>
      liveInventoryProof({
        capitalManagerRefill,
        chain,
        asset,
        tokenAddress: address,
        requiredUsd,
      }),
    )
    .filter((proof) => proof.reason !== "live_inventory_entry_asset_not_found");
  if (!proofs.length) {
    return liveInventoryProof({ capitalManagerRefill, chain, asset, tokenAddress, requiredUsd });
  }
  const readyProof = proofs
    .filter((proof) => proof.ready === true)
    .sort((left, right) => finiteNumber(right.estimatedUsd, 0) - finiteNumber(left.estimatedUsd, 0))[0];
  if (readyProof) return readyProof;
  const insufficientProof = proofs
    .filter((proof) => proof.status === "insufficient")
    .sort((left, right) => finiteNumber(right.estimatedUsd, 0) - finiteNumber(left.estimatedUsd, 0))[0];
  if (insufficientProof) return insufficientProof;
  return proofs[0];
}

function inventorySnapshotForSelector(capitalManagerRefill = {}) {
  return {
    native: uniqueInventoryRows(
      [
        ...array(capitalManagerRefill.capitalPlan?.inventory?.native),
        ...array(capitalManagerRefill.inventory?.native),
        ...array(capitalManagerRefill.fundingSourcePlan?.inventory?.native),
      ],
      "native",
    ),
    tokens: uniqueInventoryRows(
      [
        ...array(capitalManagerRefill.capitalPlan?.inventory?.tokens),
        ...array(capitalManagerRefill.inventory?.tokens),
        ...array(capitalManagerRefill.fundingSourcePlan?.inventory?.tokens),
      ],
      "token",
    ),
  };
}

function uniqueInventoryRows(rows = [], kind = "token") {
  const seen = new Set();
  return array(rows).filter((row) => {
    const key =
      kind === "native"
        ? `${normalizeChain(row?.chain)}:native`
        : `${normalizeChain(row?.chain)}:${String(row?.token || row?.address || row?.ticker || row?.symbol || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferTokenDecimalsFromInventory(row = {}) {
  const raw = finiteNumber(row.actual);
  const decimal = finiteNumber(row.actualDecimal);
  if (raw === null || decimal === null || raw <= 0 || decimal <= 0) return 6;
  const ratio = raw / decimal;
  if (!(ratio > 0)) return 6;
  const inferred = Math.round(Math.log10(ratio));
  return Number.isInteger(inferred) && inferred >= 0 && inferred <= 18 ? inferred : 6;
}

function selectorSameTickRefillProbe({
  capitalManagerRefill = {},
  chain,
  asset,
  tokenAddress,
  shortfallUsd,
  perTradeCapUsd = null,
} = {}) {
  const refillEstimatedUsd = finiteNumber(shortfallUsd);
  if (!(refillEstimatedUsd > 0) || !tokenAddress) return null;
  const inventory = inventorySnapshotForSelector(capitalManagerRefill);
  const tokenRow = findLiveInventoryToken({ capitalManagerRefill, chain, asset, tokenAddress });
  const decimals = inferTokenDecimalsFromInventory(tokenRow || {});
  const plan = {
    observedAt: capitalManagerRefill.observedAt || new Date().toISOString(),
    address: "selector-refill-probe",
    decision: "REFILL_REQUIRED",
    inventory,
    actions: [
      {
        type: "refill_token",
        chain: normalizeChain(chain),
        ticker: asset,
        asset,
        token: tokenAddress,
        refillAmount: String(Math.ceil(refillEstimatedUsd * 10 ** decimals)),
        refillAmountDecimal: refillEstimatedUsd,
        refillEstimatedUsd,
        rationale: "Selector same-tick entry asset shortfall",
        strategyPolicy: {
          id: "selector_same_tick_entry_asset_refill",
          category: "yield",
          economicsMode: "holding_period_carry",
          strategyType: "candidate_entry_asset_refill",
          actionType: "treasury_refill_for_yield",
          perTradeCapUsd: finiteNumber(perTradeCapUsd, refillEstimatedUsd),
        },
        origin: "candidate_entry_asset_refill",
      },
    ],
  };
  const funding = buildFundingSourcePlan({ plan, policy: SELECTOR_TREASURY_POLICY });
  return funding.selections[0] || null;
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

function protocolKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "")
    .replace(/v[23]$/u, "");
}

function symbolSet(value) {
  return new Set(
    String(value || "")
      .split(/[-_+/,\s]+/u)
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean),
  );
}

function matchingRepresentativeBindingForDefiLlamaPool(pool = {}) {
  const chain = normalizeChain(pool.chain);
  const protocol = protocolKey(pool.project || pool.protocol);
  const symbols = symbolSet(pool.symbol);
  for (const binding of Object.values(DESTINATION_REPRESENTATIVE_BINDINGS)) {
    if (normalizeChain(binding.chain) !== chain) continue;
    if (protocolKey(binding.protocolId) !== protocol) continue;
    if (binding.assetSymbol && !symbols.has(String(binding.assetSymbol).toUpperCase())) continue;
    return binding;
  }
  return null;
}

function defillamaSignerIntentAvailability({ binding = null, inventoryProof = {}, blockers = [] } = {}) {
  const bindingKind = binding?.bindingKind || null;
  const intentType = resolveIntentType(bindingKind);
  if (!binding) {
    return {
      ready: false,
      reason: "defillama_requires_executable_protocol_binding",
      bindingKind: null,
      intentType: null,
      builder: null,
    };
  }
  if (!intentType) {
    return {
      ready: false,
      reason: "deterministic_signer_intent_builder_missing",
      bindingKind,
      intentType: null,
      builder: null,
    };
  }
  if (inventoryProof.ready !== true) {
    return {
      ready: false,
      reason: inventoryProof.reason || "live_inventory_entry_route_required",
      bindingKind,
      intentType,
      builder: "destination_representative_autopilot",
    };
  }
  if (array(blockers).length > 0) {
    return {
      ready: false,
      reason: first(blockers, "candidate_blocked_before_policy"),
      bindingKind,
      intentType,
      builder: "destination_representative_autopilot",
    };
  }
  return {
    ready: true,
    reason: null,
    bindingKind,
    intentType,
    builder: "destination_representative_autopilot",
  };
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
    if (/inventory_unknown|inventory_missing|current_inventory_entry_route_required/.test(blocker)) {
      return false;
    }
    if (blocker === "reward_exit_liquidity_unproven" && (rewardExitProofReady || rewardExitProofStatus === "failed")) {
      return false;
    }
    if (/tiny_canary_unprofitable:/.test(blocker)) return false;
    return true;
  });
}

function merklUnderlyingEntryWhitelisted(item = {}) {
  const whitelist = new Set(
    array(MERKL_AUTO_ENTRY_POLICY.whitelistedEntrySymbols).map((value) => String(value).toUpperCase()),
  );
  const symbols = unique([
    item.protocolBindingPlan?.resolvedBinding?.assetSymbol,
    item.protocolBinding?.assetSymbol,
    item.executionReadiness?.matchedToken?.ticker,
  ]).map((value) => String(value).toUpperCase());
  return symbols.some((symbol) => whitelist.has(symbol));
}

function resolvedMerklInventoryProof(item = {}, inventoryProof = {}) {
  if (inventoryProof?.ready === true) return inventoryProof;
  if (item.executionReadiness?.status === "inventory_ready") {
    return {
      ready: true,
      status: "inventory_ready_from_queue",
      reason: null,
    };
  }
  return inventoryProof;
}

function merklExecutableBindingBlockers({ item = {}, merklOpportunity = {} } = {}) {
  const bindingPlan = item.protocolBindingPlan || {};
  if (bindingPlan.status === "binding_ready") return [];
  const type = String(merklOpportunity.type || item.type || "").toUpperCase();
  const action = String(merklOpportunity.action || item.action || "").toUpperCase();
  const dropLike = action === "DROP" || type === "ENCOMPASSING";
  if (!dropLike) return [];
  const resolvedBinding = bindingPlan.resolvedBinding || merklOpportunity.protocolBinding || {};
  const executableAddressFields = ["vaultAddress", "poolAddress", "marketAddress", "cometAddress", "cTokenAddress"];
  if (executableAddressFields.some((field) => resolvedBinding[field]) || merklOpportunity.explorerAddress) return [];
  return ["merkl_drop_campaign_entry_contract_missing", "protocol_binding_identifier_has_no_code"];
}

function merklSignerIntentAvailability({
  item = {},
  inventoryProof = {},
  blockers = [],
  blockingReasonOverride = null,
} = {}) {
  const bindingPlan = item.protocolBindingPlan || {};
  const bindingKind = bindingPlan.bindingKind || null;
  const intentType = resolveIntentType(bindingKind);
  const executableBindingBlocker = array(blockers).find((blocker) =>
    /merkl_drop_campaign_entry_contract_missing|protocol_binding_identifier_has_no_code/.test(blocker),
  );
  if (executableBindingBlocker) {
    return {
      ready: false,
      reason: executableBindingBlocker,
      bindingKind,
      intentType,
      builder: null,
    };
  }
  if (bindingPlan.status !== "binding_ready") {
    return {
      ready: false,
      reason: bindingPlan.status || "protocol_binding_not_ready",
      bindingKind,
      intentType,
      builder: null,
    };
  }
  if (!intentType) {
    return {
      ready: false,
      reason: "deterministic_signer_intent_builder_missing",
      bindingKind,
      intentType: null,
      builder: null,
    };
  }
  if (item.executionReadiness?.executorSupported !== true) {
    return {
      ready: false,
      reason: "protocol_executor_required",
      bindingKind,
      intentType,
      builder: "merkl_canary_autopilot",
    };
  }
  if (blockingReasonOverride) {
    return {
      ready: false,
      reason: blockingReasonOverride,
      bindingKind,
      intentType,
      builder: "merkl_canary_autopilot",
    };
  }
  if (inventoryProof.ready !== true) {
    return {
      ready: false,
      reason: inventoryProof.reason || "live_inventory_entry_route_required",
      bindingKind,
      intentType,
      builder: "merkl_canary_autopilot",
    };
  }
  if (array(blockers).length > 0) {
    return {
      ready: false,
      reason: first(blockers, "candidate_blocked_before_policy"),
      bindingKind,
      intentType,
      builder: "merkl_canary_autopilot",
    };
  }
  return {
    ready: true,
    reason: null,
    bindingKind,
    intentType,
    builder: "merkl_canary_autopilot",
  };
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
  const capUsd = maxTinyCanaryNotionalUsd({ strategyId, chain, activeCapitalUsd });
  const roundedNeededUsd = Math.ceil(neededUsd);
  if (capUsd !== null && finiteNumber(notionalUsd, 0) > capUsd && roundedNeededUsd <= capUsd) {
    return {
      notionalUsd: roundedNeededUsd,
      neededUsd,
      capUsd,
      resized: true,
      resizeReason: `tiny_canary_resized_within_cap_to_$${roundedNeededUsd}`,
    };
  }
  if (finiteNumber(notionalUsd, 0) >= neededUsd) return { notionalUsd, neededUsd, capUsd, resized: false };
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
    const bindingAssetSymbol =
      item.protocolBindingPlan?.resolvedBinding?.assetSymbol || merklOpportunity.protocolBinding?.assetSymbol || null;
    const asset = bindingAssetSymbol || first(item.entryAssets) || campaign.asset || campaign.rewardToken || "unknown";
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
    const initialEffectiveInventoryProof = resolvedMerklInventoryProof(item, inventoryProof);
    const rewardExitProof = rewardExitProofFor({ merklOpportunity, campaign });
    const rewardHaircut = rewardHaircutFor({ campaign, rewardExitProof });
    const holdPeriodDays =
      campaign.expectedHoldDays ??
      (finiteNumber(item.campaignRemainingHours) === null ? null : item.campaignRemainingHours / 24);
    const configuredCosts = finiteNumber(
      campaign.estimatedGasClaimSwapBridgeCostUsd,
      finiteNumber(campaign.tinyCanaryEvStatus?.roundTripCostUsd),
    );
    const costs =
      configuredCosts !== null && configuredCosts > 0
        ? configuredCosts
        : tinyCanarySameChainRoundTripCostUsd({ chain });
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
    const effectiveInventoryProof = resolvedMerklInventoryProof(
      item,
      liveInventoryProof({
        capitalManagerRefill,
        chain,
        asset,
        tokenAddress: assetAddress,
        requiredUsd: notionalUsd,
      }),
    );
    const shortfallUsd = Math.max(
      0,
      round(notionalUsd - finiteNumber(effectiveInventoryProof.estimatedUsd, 0), 6) ?? 0,
    );
    const sameTickRefillSelection =
      effectiveInventoryProof.ready === false &&
      effectiveInventoryProof.reason === "live_inventory_below_required_notional"
        ? selectorSameTickRefillProbe({
            capitalManagerRefill,
            chain,
            asset,
            tokenAddress: assetAddress,
            shortfallUsd,
            perTradeCapUsd: maxTinyCanaryNotionalUsd({ strategyId, chain, activeCapitalUsd }),
          })
        : null;
    const sameTickRefillReady = sameTickRefillSelection?.selectionStatus === "ready";
    const sameTickRefillCostUsd = sameTickRefillReady
      ? finiteNumber(sameTickRefillSelection.expectedExecutionRefillCostUsd, 0)
      : 0;
    const effectiveAprPct = displayedApr * (1 - rewardHaircut);
    const grossUsd = expectedGrossUsd({ notionalUsd, aprPct: effectiveAprPct, holdDays: holdPeriodDays });
    const totalCostUsd = finiteNumber(costs, 0) + sameTickRefillCostUsd;
    const expectedNetUsd = grossUsd === null ? campaign.expectedNetProfitUsd : grossUsd - totalCostUsd;
    const sameTickRefillBlocker = sameTickRefillReady
      ? expectedNetUsd > 0
        ? "same_tick_entry_asset_refill_required"
        : "same_tick_refill_expected_net_non_positive"
      : null;
    const inventoryBlocker =
      item.executionReadiness?.status && item.executionReadiness.status !== "inventory_ready"
        ? sameTickRefillBlocker || effectiveInventoryProof.reason || item.executionReadiness.status
        : null;
    const blockers = removeResolvedMerklBlockers(
      [
        ...merklExecutableBindingBlockers({ item, merklOpportunity }),
        ...array(item.autoEntry?.blockers),
        ...array(campaign.blockers),
        effectiveInventoryProof.ready === false && !sameTickRefillReady
          ? effectiveInventoryProof.reason || "live_inventory_entry_route_required"
          : null,
        sameTickRefillBlocker,
        inventoryBlocker,
        item.protocolBindingPlan?.status && item.protocolBindingPlan.status !== "binding_ready"
          ? item.protocolBindingPlan.status
          : null,
        rewardExitProof.ready === false ? rewardExitProof.blocker || "reward_exit_liquidity_unproven" : null,
        resize.blocker || null,
      ],
      {
        inventoryReady: effectiveInventoryProof.ready === true,
        rewardExitProofReady: rewardExitProof.ready === true,
        rewardExitProofStatus: rewardExitProof.status || null,
      },
    ).filter((blocker) => !(blocker === "entry_asset_not_whitelisted" && merklUnderlyingEntryWhitelisted(item)));
    const signerIntentAvailability = merklSignerIntentAvailability({
      item,
      inventoryProof: effectiveInventoryProof,
      blockers,
      blockingReasonOverride: sameTickRefillBlocker,
    });
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
            effectiveInventoryProof.ready === true || item.executionReadiness?.status === "inventory_ready"
              ? "ready"
              : sameTickRefillReady
                ? "same_tick_refill_ready"
                : "inventory_or_refill_required",
          ready: effectiveInventoryProof.ready === true || item.executionReadiness?.status === "inventory_ready",
          capabilityGaps:
            effectiveInventoryProof.ready === true || sameTickRefillReady ? [] : array(item.capabilityGaps),
          inventoryProof: effectiveInventoryProof,
          sameTickRefill: sameTickRefillSelection,
        },
        notionalUsd,
        holdPeriodDays,
        expectedGrossYieldUsd: grossUsd ?? campaign.operatorExpectedGrossProfitUsd,
        rewardHaircut,
        refillBridgeGasSlippageClaimSwapExitCostUsd: totalCostUsd,
        p90CostFloorUsd: sameTickRefillReady
          ? totalCostUsd
          : (campaign.tinyCanaryEvStatus?.roundTripCostUsd ?? totalCostUsd),
        expectedRealizedNetUsd: expectedNetUsd,
        blockers,
        signerIntentAvailability,
        metadata: {
          queueId: item.queueId || null,
          protocolBindingPlan: item.protocolBindingPlan || null,
          signerIntentBuilder: signerIntentAvailability,
          rewardToken: first(rewardExitProof.rewardTokens) || campaign.rewardToken || null,
          rewardTokenTypes: rewardExitProof.rewardTokenTypes || [],
          rewardExitLiquidityStatus: campaign.rewardExitLiquidityStatus || null,
          rewardExitLiquidityProof: rewardExitProof,
          inventoryProof: effectiveInventoryProof,
          initialInventoryProof: initialEffectiveInventoryProof,
          sameTickRefill: sameTickRefillSelection,
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

function normalizeDefiLlamaCandidates({ defiLlamaPools = [], capitalManagerRefill = {}, activeCapitalUsd = null }) {
  return array(defiLlamaPools)
    .slice(0, 50)
    .map((pool) => {
      const executableBinding = matchingRepresentativeBindingForDefiLlamaPool(pool);
      const apy = finiteNumber(pool.apy, finiteNumber(pool.apyBase, 0));
      const notionalUsd = Math.min(
        finiteNumber(executableBinding?.maxCanaryUsd, 25),
        finiteNumber(pool.tvlUsd, 0) > 0 ? 25 : 0,
      );
      const grossUsd = round((notionalUsd * apy * 7) / 36500);
      const inventoryProof = executableBinding
        ? liveInventoryProof({
            capitalManagerRefill,
            chain: executableBinding.chain,
            asset: executableBinding.assetSymbol || String(pool.symbol || "").split("-")[0],
            tokenAddress: executableBinding.assetAddress,
            requiredUsd: notionalUsd,
          })
        : null;
      const exitExecutorReady = executableBinding ? resolveExitExecutor(executableBinding.bindingKind) !== null : false;
      const bindingBlockers = executableBinding
        ? unique([
            inventoryProof?.ready === true ? null : inventoryProof?.reason || "live_inventory_entry_route_required",
            resolveIntentType(executableBinding.bindingKind) ? null : "deterministic_signer_intent_builder_missing",
            exitExecutorReady ? null : "unwind_path_missing",
          ])
        : ["defillama_requires_executable_protocol_binding", "unwind_path_missing", "receipt_path_missing"];
      const signerIntentAvailability = defillamaSignerIntentAvailability({
        binding: executableBinding,
        inventoryProof,
        blockers: bindingBlockers,
      });
      return makeCandidate(
        {
          source: "defillama",
          strategyId: executableBinding?.strategyId || "defillama-yield-portfolio",
          chain: pool.chain,
          asset: String(pool.symbol || "unknown").split("-")[0],
          protocol: pool.project || pool.protocol || "unknown",
          opportunityId: pool.pool || pool.poolMeta || `${pool.chain}:${pool.project}:${pool.symbol}`,
          executorBinding: executableBinding
            ? emptyBinding(resolveIntentType(executableBinding.bindingKind) ? "ready" : "missing", {
                bindingKind: executableBinding.bindingKind,
                reason: resolveIntentType(executableBinding.bindingKind)
                  ? null
                  : "deterministic_signer_intent_builder_missing",
              })
            : emptyBinding("missing", { reason: "defillama_surface_only" }),
          routeRefillBinding: executableBinding
            ? {
                status: inventoryProof.ready ? "ready" : "inventory_or_refill_required",
                ready: inventoryProof.ready === true,
                inventoryProof,
              }
            : emptyBinding("missing", { reason: "requires_bound_protocol_candidate" }),
          notionalUsd,
          holdPeriodDays: 7,
          expectedGrossYieldUsd: grossUsd,
          rewardHaircut: 0,
          refillBridgeGasSlippageClaimSwapExitCostUsd: executableBinding
            ? tinyCanarySameChainRoundTripCostUsd({ chain: executableBinding.chain })
            : null,
          p90CostFloorUsd: executableBinding
            ? tinyCanarySameChainRoundTripCostUsd({ chain: executableBinding.chain })
            : null,
          expectedRealizedNetUsd: executableBinding
            ? grossUsd - tinyCanarySameChainRoundTripCostUsd({ chain: executableBinding.chain })
            : null,
          blockers: bindingBlockers,
          signerIntentAvailability,
          metadata: {
            tvlUsd: finiteNumber(pool.tvlUsd),
            apy,
            executableBinding: executableBinding
              ? {
                  templateId: executableBinding.templateId,
                  bindingKind: executableBinding.bindingKind,
                  assetAddress: executableBinding.assetAddress,
                  evidence: executableBinding.evidence,
                }
              : null,
            inventoryProof,
          },
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

function aggressiveDescriptor(exec, top, status) {
  return {
    chain: exec?.chain || top?.chain || status.chain || "base",
    asset: exec?.assetSymbol || status.assetSymbol || "aggressive_yield_asset",
    protocol: exec?.protocol || top?.protocol || status.protocol || "aggressive_velocity",
    opportunityId: exec?.opportunityId || `aggressive:${status.strategyId}`,
  };
}

function aggressiveBlockers(status, liveReady, ladder) {
  const bottleneck = !liveReady && ladder.bottleneckStage ? `aggressive_bottleneck_${ladder.bottleneckStage}` : null;
  const reason = status.reason && !status.currentLiveEligible ? status.reason : null;
  return unique([...array(status.liveAdmissionBlockers), bottleneck, reason]);
}

function aggressiveBindings(status, exec, liveReady) {
  const state = liveReady ? "ready" : "missing";
  return {
    executor: emptyBinding(state, {
      bindingKind: exec?.bindingKind || null,
      executorBound: status.executorBound === true,
      autoExecute: status.autoExecute === true,
    }),
    route: emptyBinding(state, {
      reason: liveReady ? null : "aggressive_no_executable_candidate",
    }),
  };
}

function aggressiveMetadata(status, ladder, expectedNetBtcProfit) {
  return {
    candidateLadder: ladder,
    bottleneckStage: status.bottleneckStage || ladder.bottleneckStage || null,
    selectedCount: finiteNumber(status.selectedCount, 0),
    totalQualified: finiteNumber(status.totalQualified, 0),
    rawCandidateCount: finiteNumber(ladder.rawCandidateCount, 0),
    credibleExitCount: finiteNumber(ladder.credibleExitCount, 0),
    velocityCandidateCount: finiteNumber(ladder.velocityCandidateCount, 0),
    expectedNetBtcProfit,
    status: status.status || null,
    reason: status.reason || null,
    liveCapable: status.liveCapable === true,
    currentLiveEligible: status.currentLiveEligible === true,
  };
}

function normalizeAggressiveVelocityCandidates({ aggressiveStatus = null, activeCapitalUsd = null }) {
  if (!aggressiveStatus || !aggressiveStatus.strategyId) return [];
  const exec = aggressiveStatus.executableCandidate || null;
  const top = array(aggressiveStatus.topCandidates)[0] || null;
  const ladder = aggressiveStatus.candidateLadder || {};
  const liveReady = aggressiveStatus.currentLiveEligible === true && exec && exec.bindingKind;
  const descriptor = aggressiveDescriptor(exec, top, aggressiveStatus);
  const expectedNetBtcProfit = finiteNumber(
    exec?.expectedNetBtcProfit ?? top?.expectedNetBtcProfit ?? aggressiveStatus.totalExpectedNetBtcProfit,
    null,
  );
  const expectedNetUsd = finiteNumber(aggressiveStatus.projectedNetUsd, null);
  const bindings = aggressiveBindings(aggressiveStatus, exec, liveReady);
  const candidate = makeCandidate(
    {
      source: "aggressive_velocity",
      strategyId: aggressiveStatus.strategyId,
      chain: descriptor.chain,
      asset: descriptor.asset,
      protocol: descriptor.protocol,
      opportunityId: descriptor.opportunityId,
      executorBinding: bindings.executor,
      routeRefillBinding: bindings.route,
      notionalUsd: finiteNumber(exec?.amountUsd ?? aggressiveStatus.notionalUsd, 0),
      holdPeriodDays: finiteNumber(aggressiveStatus.expectedHoldDays, null),
      expectedGrossYieldUsd: expectedNetUsd,
      refillBridgeGasSlippageClaimSwapExitCostUsd: finiteNumber(aggressiveStatus.totalRoundtripCostUsd, null),
      p90CostFloorUsd: finiteNumber(aggressiveStatus.p90RoundTripCostUsd, null),
      expectedRealizedNetUsd: expectedNetUsd,
      blockers: aggressiveBlockers(aggressiveStatus, liveReady, ladder),
      metadata: aggressiveMetadata(aggressiveStatus, ladder, expectedNetBtcProfit),
    },
    { activeCapitalUsd },
  );
  return [candidate];
}

function buildClaimHarvestSummary({ merklUserRewards = null } = {}) {
  if (!merklUserRewards || !merklUserRewards.claimPlan) return null;
  const plan = merklUserRewards.claimPlan;
  const chains = array(plan.chains);
  const allBlockers = unique(chains.flatMap((entry) => array(entry?.blockers)));
  const topBlocker = first(allBlockers, null);
  const status =
    plan.status ||
    (finiteNumber(plan.readyChainCount, 0) > 0
      ? "ready"
      : finiteNumber(plan.blockedChainCount, 0) > 0
        ? "blocked"
        : "no_rewards");
  return {
    observedAt: merklUserRewards.observedAt || merklUserRewards.generatedAt || null,
    status,
    readyChainCount: finiteNumber(plan.readyChainCount, 0),
    blockedChainCount: finiteNumber(plan.blockedChainCount, 0),
    totalReadyClaimableUsd: finiteNumber(plan.totalReadyClaimableUsd, 0),
    totalClaimableUsd: finiteNumber(merklUserRewards.totalClaimableUsd, 0),
    totalPendingUsd: finiteNumber(merklUserRewards.totalPendingUsd, 0),
    topBlocker,
    blockers: allBlockers,
    chains: chains.map((entry) => ({
      chainId: entry?.chainId ?? null,
      chainName: entry?.chainName ?? null,
      status: entry?.status ?? null,
      claimableUsd: finiteNumber(entry?.claimableUsd, 0),
      pendingUsd: finiteNumber(entry?.pendingUsd, 0),
      rewardCount: finiteNumber(entry?.rewardCount, 0),
      blockers: array(entry?.blockers),
    })),
  };
}

function firstDefined(values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function buildPaybackAttributionSummary({ paybackStatus = null } = {}) {
  if (!paybackStatus) return null;
  const decision = paybackStatus.decision || {};
  const runway = paybackStatus.runway || {};
  const payback = paybackStatus.payback || {};
  const runwayCurrent = runway.current || {};
  const snapshot = decision.snapshot || {};
  const profitProvenance = snapshot.profitSatsProvenance || payback.profitSatsProvenance || null;
  return {
    observedAt: paybackStatus.observedAt || paybackStatus.generatedAt || null,
    decisionStatus: decision.status || null,
    decisionReason: decision.reason || null,
    grossProfitSatsPeriod: finiteNumber(
      firstDefined([
        snapshot.grossProfitSats_period,
        payback.grossProfitSatsPeriod,
        runwayCurrent.grossProfitSatsPeriod,
      ]),
      0,
    ),
    accumulatorPendingSats: finiteNumber(
      firstDefined([payback.accumulatorPendingSats, runwayCurrent.accumulatorPendingSats]),
      0,
    ),
    paidBackSatsLifetime: finiteNumber(
      firstDefined([snapshot.paidBackSats_lifetime, payback.paidBackSatsLifetime, runwayCurrent.paidBackSatsLifetime]),
      0,
    ),
    minPaybackSats: finiteNumber(runwayCurrent.minPaybackSats, 0),
    satsToMinimumPayback: finiteNumber(runwayCurrent.satsToMinimumPayback, null),
    progressToMinimumRatio: finiteNumber(runwayCurrent.progressToMinimumRatio, null),
    profitSatsProvenance: profitProvenance,
    runwayStatus: runway.status || null,
  };
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

function normalizePendleCandidates({
  pendleCandidates = [],
  merklQueue = {},
  strategyCatalog = {},
  capitalManagerRefill = {},
  activeCapitalUsd = null,
  now = null,
}) {
  const explicit = array(pendleCandidates);
  const queuePendle = array(merklQueue.queue).filter(
    (row) =>
      String(row?.protocolId || "").toLowerCase() === "pendle" ||
      row?.protocolBindingPlan?.bindingKind === "pendle_yt_buy_sell_redeem" ||
      row?.pendleYt?.ev,
  );
  const catalog = [
    ...array(strategyCatalog.btcFamilies),
    ...array(strategyCatalog.entries),
    ...array(strategyCatalog.strategies),
  ].filter((row) => /pendle/i.test(`${row.id || ""} ${row.label || ""} ${row.protocol || ""}`));
  const normalizedQueue = queuePendle.map((item) => {
    const bindingPlan = item.protocolBindingPlan || {};
    const binding = bindingPlan.resolvedBinding || item.protocolBinding || {};
    const ev = item.pendleYt?.ev || evaluatePendleYtEv(item, { now });
    const totalCostUsd =
      finiteNumber(ev?.entryCostUsd, 0) + finiteNumber(ev?.exitCostUsd, 0) + finiteNumber(ev?.gasCostUsd, 0);
    const inventoryProof = liveInventoryProofForTokenSet({
      capitalManagerRefill,
      chain: item.chain,
      asset: binding.assetSymbol || first(item.entryAssets) || item.name || "yt_entry_asset",
      tokenAddress: binding.assetAddress,
      alternativeTokenAddresses: binding.entryTokenAddresses,
      requiredUsd: ev?.notionalUsd,
    });
    const blockers = unique([
      ...array(ev?.blockers),
      ...array(item.autoEntry?.blockers).filter(
        (blocker) => !/inventory_unknown|inventory_missing|inventory_snapshot_missing/u.test(String(blocker)),
      ),
      ...array(item.capabilityGaps).filter((blocker) => blocker !== "current_inventory_entry_route_required"),
      bindingPlan.status && bindingPlan.status !== "binding_ready" ? bindingPlan.status : null,
      item.executionReadiness?.executorSupported === true ? null : "protocol_executor_required",
      inventoryProof.ready === true
        ? null
        : inventoryProof.reason || item.executionReadiness?.status || "inventory_unknown",
      item.executionReadiness?.status === "inventory_unknown" && inventoryProof.ready === true
        ? null
        : item.executionReadiness?.status && item.executionReadiness.status !== "inventory_ready"
          ? item.executionReadiness.status
          : null,
    ]);
    const bindingKind = bindingPlan.bindingKind || null;
    const intentType = resolveIntentType(bindingKind);
    const signerIntentAvailability =
      bindingPlan.status !== "binding_ready"
        ? {
            ready: false,
            reason: bindingPlan.status || "protocol_binding_not_ready",
            bindingKind,
            intentType,
            builder: null,
          }
        : !intentType
          ? {
              ready: false,
              reason: "deterministic_signer_intent_builder_missing",
              bindingKind,
              intentType: null,
              builder: null,
            }
          : item.executionReadiness?.executorSupported !== true
            ? {
                ready: false,
                reason: "protocol_executor_required",
                bindingKind,
                intentType,
                builder: "pendle_direct_canary",
              }
            : inventoryProof.ready !== true
              ? {
                  ready: false,
                  reason: inventoryProof.reason || "live_inventory_entry_route_required",
                  bindingKind,
                  intentType,
                  builder: "pendle_direct_canary",
                }
              : blockers.length > 0
                ? { ready: false, reason: first(blockers), bindingKind, intentType, builder: "pendle_direct_canary" }
                : { ready: true, reason: null, bindingKind, intentType, builder: "pendle_direct_canary" };
    return makeCandidate(
      {
        source: "pendle",
        strategyId: item.mappedStrategyId || "pendle-yt-canary",
        chain: item.chain || "base",
        asset: inventoryProof.asset || first(item.entryAssets) || binding.assetSymbol || item.name || "pt_or_yt",
        protocol: item.protocolId || "pendle",
        opportunityId: item.opportunityId || item.queueId || binding.marketAddress || "pendle",
        executorBinding: emptyBinding(
          item.executionReadiness?.executorSupported === true && bindingPlan.status === "binding_ready"
            ? "ready"
            : "missing",
          {
            bindingKind,
            market: binding.marketAddress || null,
          },
        ),
        routeRefillBinding: {
          status: inventoryProof.ready === true ? "ready" : "inventory_or_refill_required",
          ready: inventoryProof.ready === true,
          inventoryProof,
        },
        notionalUsd: ev?.notionalUsd || item.notionalUsd || 0,
        holdPeriodDays: ev?.holdDays ?? item.holdPeriodDays ?? null,
        expectedGrossYieldUsd: ev?.grossYieldUsd ?? null,
        rewardHaircut: finiteNumber(ev?.rewardHaircutPct) === null ? null : ev.rewardHaircutPct / 100,
        refillBridgeGasSlippageClaimSwapExitCostUsd: totalCostUsd,
        p90CostFloorUsd: totalCostUsd,
        expectedRealizedNetUsd: ev?.expectedNetUsd ?? null,
        blockers,
        signerIntentAvailability,
        metadata: {
          queueId: item.queueId || null,
          protocolBindingPlan: bindingPlan,
          pendleYtEv: ev,
          inventoryProof,
          underlyingAsset: binding.assetSymbol || item.name || null,
          entryTokenAddresses: array(binding.entryTokenAddresses),
        },
      },
      { activeCapitalUsd },
    );
  });
  const normalizedExplicit = [...explicit, ...catalog].map((row) =>
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
  return [...normalizedQueue, ...normalizedExplicit];
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
  const rows = candidates.map((candidate) => {
    const blockers = unique([
      ...array(candidate.blockers),
      ...array(candidate.capResult?.blockers),
      ...array(candidate.policyResult?.blockers),
    ]);
    return {
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
      blockers,
      lifecycleEvidence: candidate.lifecycleEvidence || null,
      nextLegalCapitalAction: nextLegalCapitalAction({
        blockers,
        capResult: candidate.capResult,
        expectedRealizedNetUsd: candidate.expectedRealizedNetUsd,
        lifecycleEvidence: candidate.lifecycleEvidence,
      }),
    };
  });
  const seenSources = new Set(rows.map((row) => row.source));
  for (const source of ALL_SOURCE_DEPLOYMENT_SOURCES) {
    if (!seenSources.has(source)) {
      const blockers = [`${source}_candidate_missing`];
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
        blockers,
        nextLegalCapitalAction: nextLegalCapitalAction({ blockers }),
      });
    }
  }
  return rows;
}

function refillJobsFromOptions(options) {
  return array(options?.refillPlan?.jobs);
}

function computeFamilyActionTable(familyCoverage, candidates, options) {
  return buildFamilyActionTable(familyCoverage, {
    nextLegalDistByFamily: nextLegalActionsByFamily(candidates),
    refillJobs: refillJobsFromOptions(options),
  });
}

function nextLegalActionsByFamily(candidates) {
  const counts = {};
  for (const candidate of array(candidates)) {
    const action = candidate?.nextLegalCapitalAction?.action;
    if (!action) continue;
    const families = familySetForSurface(candidate);
    for (const family of families) {
      if (!counts[family]) counts[family] = {};
      counts[family][action] = (counts[family][action] || 0) + 1;
    }
  }
  return counts;
}

function sourceCoverage(candidates) {
  return ALL_SOURCE_DEPLOYMENT_SOURCES.map((source) => {
    const rows = candidates.filter((candidate) => candidate.source === source);
    const actions = rows.map((candidate) => candidate.nextLegalCapitalAction?.action).filter(Boolean);
    const actionCounts = {};
    for (const action of actions) actionCounts[action] = (actionCounts[action] || 0) + 1;
    const topAction =
      Object.entries(actionCounts).sort((left, right) => right[1] - left[1])[0]?.[0] ||
      (rows.length === 0 ? "no_trade_safety" : null);
    return {
      source,
      candidateCount: rows.length,
      evPositiveCount: rows.filter((candidate) => finiteNumber(candidate.expectedRealizedNetUsd, -1) > 0).length,
      policyAttemptedCount: rows.filter((candidate) => candidate.policyResult).length,
      topBlockers: unique(rows.flatMap((candidate) => candidate.blockers)).slice(0, 8),
      nextLegalCapitalActionCounts: actionCounts,
      topNextLegalCapitalAction: topAction,
    };
  });
}

function lowerText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.toLowerCase();
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

const SOURCE_TO_EXCLUSIVE_FAMILY = Object.freeze({
  defillama: "defillama",
  radar_campaign: "radar",
  aggressive_velocity: "aggressive",
});

function familySetForSurface(surface = {}) {
  const exclusive = SOURCE_TO_EXCLUSIVE_FAMILY[surface.source];
  if (exclusive) return [exclusive];
  const text = lowerText(surface);
  const families = new Set();
  if (surface.source === "pendle" || surface.pendleYt || /pendle|pendle-yt|yt-canary/.test(text)) {
    families.add("pendle");
  }
  if (surface.source === "merkl" || /merkl/.test(text)) families.add("merkl");
  if (/defillama/.test(text)) families.add("defillama");
  if (surface.source === "stable_carry" || /stablecarry|stable_treasury_carry|stablecoin|usdc|usdt|dai/.test(text)) {
    families.add("stable_carry");
  }
  if (surface.source === "btc_wrapper_lending" || /wrapped.?btc|btc_wrappers|cbbtc|wbtc|moonwell/.test(text)) {
    families.add("btc_wrapper_lending");
  }
  if (surface.source === "tokenized_gold_reserve" || /tokenized.*(gold|reserve)|xaut|paxg|reserve_sleeve/.test(text)) {
    families.add("tokenized_gold_reserve");
  }
  if (/radar/.test(text)) families.add("radar");
  if (/aggressive[-_]?velocity|aggressive_yield/.test(text)) families.add("aggressive");
  if (surface.source === "strategy_catalog" || surface.catalogSurface === true) families.add("strategy_catalog");
  return [...families].filter((family) => DEPLOYMENT_SELECTOR_FAMILIES.includes(family));
}

function emptyUnreconciledBySource() {
  return {
    transactionNoReceipt: 0,
    broadcastBucketNoReceipt: 0,
    reconciliationStatus: 0,
    signerAuditRecord: 0,
    issueRecord: 0,
  };
}

// Action-decision codes for active positions. Replaces the legacy generic
// POSITION_HEALTHY_NO_ACTION_PRODUCER catch-all with a deterministic per-position decision
// derived only from structured mark fields (no substring/JSON regex). The producer is
// `derivePositionActionDecision(mark)` and runs once per deduped position mark.
//
//   HEALTH_CHECK_REQUIRED   — event=position_mark_failed; on-chain state unreadable.
//                             reason carries the exact failureKind (adapter_error,
//                             zero_position_observed, rpc_failed, …).
//   UNSUPPORTED_BINDING     — event=position_marked but mark.bindingKind is not in
//                             protocol-binding-registry. reason carries the missing
//                             bindingKind plus protocolId so the gap is auditable.
//   CLAIM_READY             — claim summary (merkl-user-rewards) has ready claimable usd.
//                             Only emitted on the merkl row via claim-economics join.
//   CLAIM_BLOCKED           — claim summary has pending or dust claimable. reason carries
//                             the upstream claim blocker (claimable_below_min_usd, …).
//   HOLD_NOOP               — event=position_marked, binding supported, no claim/harvest/
//                             exit producer joined for this row. Concrete "do nothing
//                             until a producer is added" verdict.
//
// activeActionEconomics fields:
//   markFailedCount, markedHealthyCount   — split by `event`
//   markFailureKinds                       — {adapter_error, rpc_failed, …}
//   totalActiveValueUsd                    — sum of mark.valueUsd for active marks
//   claimReadyUsd, claimPendingUsd         — from merklUserRewards.claimPlan
//   claimChainReadyCount, claimTopBlocker  — claim-plan plumbing
//   perPositionDecisions[]                 — one entry per deduped active mark
//   topActiveActionReason                  — highest-priority code across the row
const POSITION_ACTION_PRIORITY = Object.freeze([
  "HEALTH_CHECK_REQUIRED",
  "UNSUPPORTED_BINDING",
  "CLAIM_READY",
  "CLAIM_BLOCKED",
  "HOLD_NOOP",
]);

function bindingKeyOf(protocolId, bindingKind) {
  if (!bindingKind) return `${protocolId || "unknown"}:<missing_binding_kind>`;
  return `${protocolId || "unknown"}:${bindingKind}`;
}

// executableActionPath surfaces the producer-level truth for the *next legal
// action* on this position. Five fields, common across families:
//   action               — primary legal action: health_check|exit|hold|claim
//   bindingKey           — `${protocol}:${bindingKind}` or null
//   producer             — resolved executor function name (string) or null
//   dispatchEligibility  — ready|hold_no_action_required|unsupported_binding
//                          |position_unhealthy|exit_producer_not_resolved
//   blocker              — structured blocker key (null if dispatch is ready
//                          or hold-with-no-required-action)
function deriveExecutableActionPath(mark, decision) {
  const protocolId = mark.protocolId || null;
  const bindingKind = mark.bindingKind || null;
  if (decision.actionDecision === "HEALTH_CHECK_REQUIRED") {
    return {
      action: "health_check",
      bindingKey: bindingKind ? bindingKeyOf(protocolId, bindingKind) : null,
      producer: null,
      dispatchEligibility: "position_unhealthy",
      blocker: decision.actionReason,
    };
  }
  if (decision.actionDecision === "UNSUPPORTED_BINDING") {
    return {
      action: "exit",
      bindingKey: decision.missingBindingKey,
      producer: null,
      dispatchEligibility: "unsupported_binding",
      blocker: "binding_kind_not_registered",
    };
  }
  if (decision.actionDecision === "HOLD_NOOP") {
    const exitFn = resolveExitExecutor(bindingKind);
    return {
      action: "hold",
      bindingKey: bindingKeyOf(protocolId, bindingKind),
      producer: exitFn?.name || null,
      dispatchEligibility: exitFn ? "hold_no_action_required" : "exit_producer_not_resolved",
      blocker: exitFn ? null : "exit_producer_not_resolved",
    };
  }
  return null;
}

function derivePositionActionDecision(mark = {}) {
  const positionId = mark.positionId || null;
  const strategyId = mark.strategyId || null;
  const protocolId = mark.protocolId || null;
  const bindingKind = mark.bindingKind || null;
  const valueUsd = finiteNumber(mark.valueUsd, 0);
  let decision = null;
  if (mark.event === "position_mark_failed") {
    const failureKind = String(mark.failureKind || "unknown_failure").toLowerCase();
    decision = {
      positionId,
      strategyId,
      protocolId,
      bindingKind,
      valueUsd: 0,
      actionDecision: "HEALTH_CHECK_REQUIRED",
      actionReason: `position_mark_failed:${failureKind}`,
      missingBindingKey: null,
    };
  } else if (mark.event !== "position_marked") {
    return null;
  } else if (!bindingKind || !isSupportedBindingKind(bindingKind)) {
    decision = {
      positionId,
      strategyId,
      protocolId,
      bindingKind,
      valueUsd,
      actionDecision: "UNSUPPORTED_BINDING",
      actionReason: "binding_kind_not_registered",
      missingBindingKey: bindingKeyOf(protocolId, bindingKind),
    };
  } else {
    decision = {
      positionId,
      strategyId,
      protocolId,
      bindingKind,
      valueUsd,
      actionDecision: "HOLD_NOOP",
      actionReason: "no_claim_harvest_exit_producer_joined",
      missingBindingKey: null,
    };
  }
  decision.executableActionPath = deriveExecutableActionPath(mark, decision);
  return decision;
}

function emptyActiveActionEconomics() {
  return {
    markFailedCount: 0,
    markedHealthyCount: 0,
    markFailureKinds: {},
    totalActiveValueUsd: 0,
    claimReadyUsd: 0,
    claimPendingUsd: 0,
    claimChainReadyCount: 0,
    claimTopBlocker: null,
    perPositionDecisions: [],
    topActiveActionReason: null,
  };
}

function emptyFamilyCoverageRow(family) {
  return {
    family,
    discoveredCandidateCount: 0,
    activePositionCount: 0,
    unreconciledBroadcastCount: 0,
    unreconciledBySource: emptyUnreconciledBySource(),
    activeActionEconomics: emptyActiveActionEconomics(),
    evPositiveCandidateCount: 0,
    policyEligibleCandidateCount: 0,
    signerIntentReadyCount: 0,
    receiptReadyCount: 0,
    capitalAuditReadyCount: 0,
    selectedAction: "observe",
    firstBlockingReason: "NO_SURFACE_EVIDENCE",
    actionCandidates: [],
  };
}

function familyCoverageMap() {
  return new Map(DEPLOYMENT_SELECTOR_FAMILIES.map((family) => [family, emptyFamilyCoverageRow(family)]));
}

function addAction(row, action) {
  if (action && !row.actionCandidates.includes(action)) row.actionCandidates.push(action);
}

function mergeUnreconciledBySource(rowBySource, inputBySource) {
  if (!inputBySource || typeof inputBySource !== "object") return;
  for (const [sourceKey, increment] of Object.entries(inputBySource)) {
    if (!Object.prototype.hasOwnProperty.call(rowBySource, sourceKey)) continue;
    rowBySource[sourceKey] += finiteNumber(increment, 0);
  }
}

function mergeActiveActionEconomics(econ, input) {
  econ.markFailedCount += finiteNumber(input.markFailedCount, 0);
  econ.markedHealthyCount += finiteNumber(input.markedHealthyCount, 0);
  econ.totalActiveValueUsd += finiteNumber(input.totalActiveValueUsd, 0);
  econ.claimReadyUsd += finiteNumber(input.claimReadyUsd, 0);
  econ.claimPendingUsd += finiteNumber(input.claimPendingUsd, 0);
  econ.claimChainReadyCount += finiteNumber(input.claimChainReadyCount, 0);
  if (input.claimTopBlocker && !econ.claimTopBlocker) econ.claimTopBlocker = input.claimTopBlocker;
  if (input.markFailureKinds && typeof input.markFailureKinds === "object") {
    for (const [kind, count] of Object.entries(input.markFailureKinds)) {
      econ.markFailureKinds[kind] = (econ.markFailureKinds[kind] || 0) + finiteNumber(count, 0);
    }
  }
  if (Array.isArray(input.perPositionDecisions)) {
    for (const decision of input.perPositionDecisions) {
      if (decision && typeof decision === "object") econ.perPositionDecisions.push(decision);
    }
  }
}

function addFamilySurface(rows, family, fields = {}) {
  const row = rows.get(family);
  if (!row) return;
  row.discoveredCandidateCount += finiteNumber(fields.discoveredCandidateCount, 0);
  row.activePositionCount += finiteNumber(fields.activePositionCount, 0);
  row.unreconciledBroadcastCount += finiteNumber(fields.unreconciledBroadcastCount, 0);
  mergeUnreconciledBySource(row.unreconciledBySource, fields.unreconciledBySource);
  if (fields.activeActionEconomics && typeof fields.activeActionEconomics === "object") {
    mergeActiveActionEconomics(row.activeActionEconomics, fields.activeActionEconomics);
  }
  row.evPositiveCandidateCount += finiteNumber(fields.evPositiveCandidateCount, 0);
  row.policyEligibleCandidateCount += finiteNumber(fields.policyEligibleCandidateCount, 0);
  row.signerIntentReadyCount += finiteNumber(fields.signerIntentReadyCount, 0);
  row.receiptReadyCount += finiteNumber(fields.receiptReadyCount, 0);
  row.capitalAuditReadyCount += finiteNumber(fields.capitalAuditReadyCount, 0);
  for (const action of array(fields.actionCandidates)) addAction(row, action);
  if (fields.blockingReason && row.firstBlockingReason === "NO_SURFACE_EVIDENCE") {
    row.firstBlockingReason = fields.blockingReason;
  }
}

function firstCandidateBlocker(candidate) {
  return first(
    [...array(candidate.blockers), ...array(candidate.capResult?.blockers), ...array(candidate.policyResult?.blockers)],
    null,
  );
}

function addCandidateFamilyCoverage(rows, candidate) {
  const families = familySetForSurface(candidate);
  const isPolicyEligible = candidatePolicyEligible(candidate);
  for (const family of families) {
    addFamilySurface(rows, family, {
      discoveredCandidateCount: 1,
      evPositiveCandidateCount: finiteNumber(candidate.expectedRealizedNetUsd, -1) > 0 ? 1 : 0,
      policyEligibleCandidateCount: isPolicyEligible ? 1 : 0,
      signerIntentReadyCount: candidate.signerIntentAvailability?.ready === true ? 1 : 0,
      receiptReadyCount: candidate.receiptCapitalAuditPath?.capitalAuditRequired === true ? 1 : 0,
      capitalAuditReadyCount:
        candidate.receiptCapitalAuditPath?.capitalAuditRequired === true &&
        !array(candidate.blockers).some((blocker) => /receipt|capital.?audit/i.test(blocker))
          ? 1
          : 0,
      blockingReason: firstCandidateBlocker(candidate),
      actionCandidates: isPolicyEligible ? ["policy_attempt"] : ["refill_or_increase"],
    });
  }
}

function addMerklQueueFamilyCoverage(rows, merklQueue = {}) {
  let pendleQueueCount = 0;
  for (const item of array(merklQueue.queue)) {
    const families = familySetForSurface({ ...item, source: "merkl" });
    for (const family of families) {
      if (family === "pendle") pendleQueueCount += 1;
      addFamilySurface(rows, family, {
        discoveredCandidateCount: 1,
        activePositionCount: item.executionReadiness?.openPosition ? 1 : 0,
        blockingReason: first(
          [...array(item.autoEntry?.blockers), ...array(item.capabilityGaps)],
          item.executionReadiness?.status,
        ),
        actionCandidates: item.executionReadiness?.openPosition
          ? ["hold", "exit", "unwind", "claim"]
          : ["refill_or_increase"],
      });
    }
  }
  const pendleSummaryCount = Math.max(
    finiteNumber(merklQueue.summary?.pendleYtCount, 0),
    finiteNumber(merklQueue.summary?.byStrategy?.["pendle-yt-canary"], 0),
  );
  if (pendleSummaryCount > pendleQueueCount) {
    addFamilySurface(rows, "pendle", {
      discoveredCandidateCount: pendleSummaryCount - pendleQueueCount,
      signerIntentReadyCount: Math.max(
        0,
        finiteNumber(merklQueue.summary?.pendleYtCanaryReadyCount, 0) -
          array(merklQueue.queue).filter((item) => item?.pendleYt?.ev?.canaryReady === true).length,
      ),
      blockingReason: "NO_POLICY_ELIGIBLE_TRADE",
      actionCandidates: ["refill_or_increase"],
    });
  }
}

function addCampaignAwareFamilyCoverage(rows, campaignAware = {}) {
  for (const candidate of array(campaignAware.candidates)) {
    const families = familySetForSurface(candidate);
    for (const family of families) {
      addFamilySurface(rows, family, {
        discoveredCandidateCount: 1,
        evPositiveCandidateCount: finiteNumber(candidate.operatorExpectedNetProfitUsd, -1) > 0 ? 1 : 0,
        blockingReason: first(candidate.blockers, candidate.entryStatus || null),
        actionCandidates: ["refill_or_increase"],
      });
    }
  }
}

function strategyCatalogRows(strategyCatalog = {}) {
  return [
    ...array(strategyCatalog.btcFamilies),
    ...array(strategyCatalog.ethBranches),
    ...array(strategyCatalog.entries),
    ...array(strategyCatalog.strategies),
  ];
}

function addCatalogFamilyCoverage(rows, strategyCatalog = {}) {
  for (const row of strategyCatalogRows(strategyCatalog)) {
    const families = familySetForSurface({ ...row, catalogSurface: true });
    for (const family of families) {
      addFamilySurface(rows, family, {
        discoveredCandidateCount: 1,
        blockingReason: first(row.blockers, row.status || null),
        actionCandidates: ["refill_or_increase"],
      });
    }
  }
}

function addAllocatorFamilyCoverage(rows, allocatorCore = {}) {
  for (const candidate of array(allocatorCore.candidates)) {
    const families = familySetForSurface(candidate);
    for (const family of families) {
      addFamilySurface(rows, family, {
        discoveredCandidateCount: 1,
        evPositiveCandidateCount: finiteNumber(candidate.expectedRealizedNetUsd, -1) > 0 ? 1 : 0,
        blockingReason: first(candidate.blockers, candidate.status || null),
        actionCandidates: ["refill_or_increase"],
      });
    }
  }
}

function addRadarFamilyCoverage(rows, radarBoard = {}) {
  const radarRows = [
    ...array(radarBoard.candidates),
    ...array(radarBoard.opportunities),
    ...array(radarBoard.executable),
  ];
  for (const candidate of radarRows) {
    addFamilySurface(rows, "radar", {
      discoveredCandidateCount: 1,
      evPositiveCandidateCount: finiteNumber(candidate.expectedRealizedNetUsd, -1) > 0 ? 1 : 0,
      blockingReason: first(candidate.blockers, candidate.status || null),
      actionCandidates: ["refill_or_increase"],
    });
  }
}

// Receipt-reconciliation evidence must come from explicit reconciliation fields,
// not from a derived `broadcast.txHash && !record.receipt` heuristic. Signer audit
// records by schema never carry an inline `receipt` field, so the derived form
// flagged ~37k signer rows as unreconciled regardless of whether the ledger had
// actually settled them (join bug between signer audit and capitalAudit.transactions).
// Source-of-truth lifecycle is `capitalAudit.transactions[].result` (per-tx) and
// `capitalAudit.broadcastBreakdown[].result` (per-bucket); both expose `no_receipt`
// when the ledger join failed to find a confirmed receipt. `reconciliationStatus`
// is an explicit downstream tag if a producer adds one. Everything else is silence,
// not evidence.
function unreconciledSurface(record) {
  if (record?.result === "no_receipt") return true;
  if (record?.result === "unreconciled" || record?.result === "unmatched") return true;
  if (typeof record?.reconciliationStatus === "string") {
    const status = record.reconciliationStatus.toLowerCase();
    if (status === "unreconciled" || status === "unmatched" || status === "no_receipt") return true;
  }
  return false;
}

function unreconciledSourceKey(surface, sourceKind) {
  if (typeof surface?.reconciliationStatus === "string") return "reconciliationStatus";
  if (sourceKind === "transaction") return "transactionNoReceipt";
  if (sourceKind === "broadcastBucket") return "broadcastBucketNoReceipt";
  if (sourceKind === "signer") return "signerAuditRecord";
  if (sourceKind === "issue") return "issueRecord";
  return null;
}

function activePositionSurface(record) {
  const text = lowerText(record);
  return /active|open|verified_current|position_open/.test(text) && /position|protocol|mark|vault/.test(text);
}

// Strict, structured classifier for protocolPositionMarks. Only consults explicit
// producer fields (strategyId → protocolId), never regex over JSON.stringify(mark).
// Returns exactly one family. Marks that do not match a known strategy-universe lane
// are routed to `ambiguous_position_family`, not silently bled into merkl/pendle/etc.
function familySetForPositionMark(mark = {}) {
  const strategyId = String(mark.strategyId || "").toLowerCase();
  if (strategyId && STRATEGY_ID_TO_MARK_FAMILY[strategyId]) {
    return [STRATEGY_ID_TO_MARK_FAMILY[strategyId]];
  }
  const protocolId = String(mark.protocolId || "").toLowerCase();
  if (protocolId && PROTOCOL_ID_TO_MARK_FAMILY[protocolId]) {
    return [PROTOCOL_ID_TO_MARK_FAMILY[protocolId]];
  }
  return ["ambiguous_position_family"];
}

// Mark records are appended one per scanner poll, so the same positionId appears
// thousands of times. The active-position summary must dedup to the latest mark per
// positionId before counting/summing, otherwise activePositionCount and
// totalActiveValueUsd both inflate by the poll count (the pendle $26.8M YT position
// reported $72.6B = 26.8M × ~2706 polls before this dedup).
function latestMarksByPositionId(marks = []) {
  const latest = new Map();
  for (const mark of marks) {
    if (!mark || typeof mark !== "object") continue;
    const positionId = mark.positionId;
    if (!positionId) continue;
    const prior = latest.get(positionId);
    if (!prior) {
      latest.set(positionId, mark);
      continue;
    }
    const priorTs = Date.parse(prior.observedAt || "") || 0;
    const currentTs = Date.parse(mark.observedAt || "") || 0;
    if (currentTs >= priorTs) latest.set(positionId, mark);
  }
  return [...latest.values()];
}

function addAuditSurfaceCoverage(rows, capitalAudit, signerAuditRecords) {
  const auditSurfaces = [
    ...array(capitalAudit.issues).map((surface) => ({ surface, sourceKind: "issue" })),
    ...array(capitalAudit.transactions).map((surface) => ({ surface, sourceKind: "transaction" })),
    ...array(capitalAudit.broadcastBreakdown).map((surface) => ({ surface, sourceKind: "broadcastBucket" })),
    ...array(signerAuditRecords).map((surface) => ({ surface, sourceKind: "signer" })),
  ];
  for (const { surface, sourceKind } of auditSurfaces) {
    const families = familySetForSurface(surface);
    for (const family of families) {
      const unreconciled = unreconciledSurface(surface);
      const sourceKey = unreconciled ? unreconciledSourceKey(surface, sourceKind) : null;
      addFamilySurface(rows, family, {
        discoveredCandidateCount: 1,
        unreconciledBroadcastCount: unreconciled ? 1 : 0,
        unreconciledBySource: sourceKey ? { [sourceKey]: 1 } : null,
        blockingReason: unreconciled ? "NO_RECEIPT_RECONCILIATION" : firstCandidateBlocker(surface),
        actionCandidates: unreconciled ? ["reconcile_receipt"] : ["hold"],
      });
    }
  }
}

function buildActiveMarkEconomics(mark, active) {
  if (!active) return null;
  const markFailed = mark?.event === "position_mark_failed";
  const markedHealthy = mark?.event === "position_marked";
  const failureKindKey = markFailed ? String(mark.failureKind || "unknown_failure").toLowerCase() : null;
  const decision = derivePositionActionDecision(mark);
  return {
    markFailedCount: markFailed ? 1 : 0,
    markedHealthyCount: markedHealthy ? 1 : 0,
    markFailureKinds: failureKindKey ? { [failureKindKey]: 1 } : {},
    totalActiveValueUsd: finiteNumber(mark?.valueUsd, 0),
    perPositionDecisions: decision ? [decision] : [],
  };
}

function addPositionMarkCoverage(rows, protocolPositionMarks) {
  // Dedup marks to the latest entry per positionId, then classify with the strict
  // structured classifier. This is the only place the active-position summary should
  // increment activePositionCount / totalActiveValueUsd from marks; raw mark stream
  // bypasses inflation by poll count.
  const dedupedMarks = latestMarksByPositionId(array(protocolPositionMarks));
  for (const mark of dedupedMarks) {
    const families = familySetForPositionMark(mark);
    const active = activePositionSurface(mark);
    const economics = buildActiveMarkEconomics(mark, active);
    for (const family of families) {
      addFamilySurface(rows, family, {
        discoveredCandidateCount: 1,
        activePositionCount: active ? 1 : 0,
        blockingReason: active ? "NO_NEW_ENTRY_BUT_ACTIVE_POSITION_ACTION_REQUIRED" : firstCandidateBlocker(mark),
        actionCandidates: active ? ["hold", "exit", "unwind", "claim"] : ["reconcile_receipt"],
        activeActionEconomics: economics,
      });
    }
  }
}

function addAuditAndPositionFamilyCoverage(
  rows,
  { capitalAudit = {}, signerAuditRecords = [], protocolPositionMarks = [] },
) {
  addAuditSurfaceCoverage(rows, capitalAudit, signerAuditRecords);
  addPositionMarkCoverage(rows, protocolPositionMarks);
}

function applyClaimEconomicsToFamilyRows(rows, options = {}) {
  const summary = buildClaimHarvestSummary(options);
  if (!summary) return;
  // Today only the merkl-user-rewards producer carries a structured claimPlan,
  // so the join only applies to the merkl family row. When a per-family claim
  // producer is added for pendle/stable_carry/btc_wrapper_lending, this is the
  // single place to extend the join (still common-structure only).
  const merklRow = rows.get("merkl");
  if (!merklRow) return;
  addFamilySurface(rows, "merkl", {
    activeActionEconomics: {
      claimReadyUsd: finiteNumber(summary.totalReadyClaimableUsd, 0),
      claimPendingUsd: finiteNumber(summary.totalPendingUsd, 0),
      claimChainReadyCount: finiteNumber(summary.readyChainCount, 0),
      claimTopBlocker: summary.topBlocker || null,
    },
  });
}

function deriveTopActiveActionReason(row) {
  const econ = row.activeActionEconomics;
  if (!econ) return null;
  const claimReady = finiteNumber(econ.claimReadyUsd, 0) > 0;
  const claimPending = finiteNumber(econ.claimPendingUsd, 0) > 0 && econ.claimTopBlocker;
  const codeCounts = new Map();
  for (const decision of array(econ.perPositionDecisions)) {
    if (!decision || !decision.actionDecision) continue;
    codeCounts.set(decision.actionDecision, (codeCounts.get(decision.actionDecision) || 0) + 1);
  }
  if (claimReady) codeCounts.set("CLAIM_READY", (codeCounts.get("CLAIM_READY") || 0) + 1);
  if (claimPending && !claimReady) codeCounts.set("CLAIM_BLOCKED", (codeCounts.get("CLAIM_BLOCKED") || 0) + 1);
  for (const code of POSITION_ACTION_PRIORITY) {
    if (codeCounts.has(code)) {
      if (code === "CLAIM_BLOCKED" && econ.claimTopBlocker) return econ.claimTopBlocker;
      return code;
    }
  }
  return null;
}

function finalizeFamilyCoverage(rows, selectedCandidate) {
  const selectedFamilies = new Set(selectedCandidate ? familySetForSurface(selectedCandidate) : []);
  return DEPLOYMENT_SELECTOR_FAMILIES.map((family) => {
    const row = rows.get(family);
    if (selectedFamilies.has(family)) {
      row.selectedAction = selectedCandidate?.signerIntentAvailability?.ready
        ? "signer_intent_ready"
        : "policy_attempt";
      row.firstBlockingReason = selectedCandidate?.policyResult?.decision === "ALLOW" ? null : row.firstBlockingReason;
    } else if (row.unreconciledBroadcastCount > 0) {
      row.selectedAction = "reconcile_receipt";
      row.firstBlockingReason = "NO_RECEIPT_RECONCILIATION";
    } else if (row.activePositionCount > 0 && row.policyEligibleCandidateCount === 0) {
      row.selectedAction = "hold_or_health_action";
      const derived = deriveTopActiveActionReason(row);
      row.activeActionEconomics.topActiveActionReason = derived || "NO_NEW_ENTRY_BUT_ACTIVE_POSITION_ACTION_REQUIRED";
      row.firstBlockingReason = derived || "NO_NEW_ENTRY_BUT_ACTIVE_POSITION_ACTION_REQUIRED";
    } else if (row.policyEligibleCandidateCount > 0) {
      row.selectedAction = "policy_attempt_ready";
    } else if (row.evPositiveCandidateCount > 0) {
      row.selectedAction = "resolve_policy_or_signer_blockers";
    } else if (row.discoveredCandidateCount > 0) {
      row.selectedAction = "resolve_blockers";
      if (row.firstBlockingReason === "NO_SURFACE_EVIDENCE") row.firstBlockingReason = "NO_POLICY_ELIGIBLE_TRADE";
    }
    return row;
  });
}

function buildFamilyCoverage(candidates, options = {}, selectedCandidate = null) {
  const rows = familyCoverageMap();
  for (const candidate of candidates) addCandidateFamilyCoverage(rows, candidate);
  addMerklQueueFamilyCoverage(rows, options.merklQueue);
  addCampaignAwareFamilyCoverage(rows, options.campaignAware);
  addCatalogFamilyCoverage(rows, options.strategyCatalog);
  addAllocatorFamilyCoverage(rows, options.allocatorCore);
  addRadarFamilyCoverage(rows, options.radarBoard);
  addAuditAndPositionFamilyCoverage(rows, options);
  applyClaimEconomicsToFamilyRows(rows, options);
  applyTopEvCandidateBlockers(rows, candidates);
  applyFreshRadarZeroEvidence(rows, options.radarBoard);
  return finalizeFamilyCoverage(rows, selectedCandidate);
}

function applyTopEvCandidateBlockers(rows, candidates = []) {
  const byFamily = new Map();
  for (const candidate of [...candidates]
    .filter((item) => finiteNumber(item.expectedRealizedNetUsd, -1) > 0)
    .sort(candidateRank)) {
    const blocker = firstCandidateBlocker(candidate);
    if (!blocker) continue;
    for (const family of familySetForSurface(candidate)) {
      if (!byFamily.has(family)) byFamily.set(family, blocker);
    }
  }
  for (const [family, blocker] of byFamily.entries()) {
    const row = rows.get(family);
    if (!row) continue;
    row.firstBlockingReason = blocker;
  }
}

function applyFreshRadarZeroEvidence(rows, radarBoard = {}) {
  const row = rows.get("radar");
  if (!row || row.discoveredCandidateCount > 0) return;
  const observedCount = finiteNumber(radarBoard.summary?.observedCount, 0);
  const candidateCount = finiteNumber(radarBoard.summary?.candidateCount, array(radarBoard.candidates).length);
  const executableCount = finiteNumber(radarBoard.summary?.executableCount, array(radarBoard.executable).length);
  if (radarBoard.generatedAt && observedCount === 0 && candidateCount === 0 && executableCount === 0) {
    row.firstBlockingReason = "RADAR_BOARD_FRESH_ZERO";
    row.selectedAction = "observe";
  }
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

function buildLaneHandlerPilotReport({ now, actionLaneQueue, options }) {
  return buildLaneHandlerReport({
    selectorReport: {
      generatedAt: now,
      actionLaneQueue,
    },
    refillPlannerReport: options.capitalManagerRefill || {},
    receiptReport: options.receiptLedger || {},
    now,
  });
}

function laneHandlerPilotSummary(laneHandlerReport) {
  return {
    status: laneHandlerReport.status,
    selectedPilotLane: laneHandlerReport.selectedPilotLane,
    reportOnly: laneHandlerReport.reportOnly,
    canLive: laneHandlerReport.canLive,
    runtimeAuthority: laneHandlerReport.runtimeAuthority,
    allowedToExecuteLive: laneHandlerReport.allowedToExecuteLive,
    liveExecutionAuthority: laneHandlerReport.liveExecutionAuthority,
    handlerResults: laneHandlerReport.handlerResults,
    handlerBacklog: laneHandlerReport.handlerBacklog,
    safety: laneHandlerReport.safety,
  };
}

function buildRemediationLifecycleBundle({ now, dryRunRemediationPlan, options }) {
  const laneHandlerReport = buildLaneHandlerPilotReport({
    now,
    actionLaneQueue: dryRunRemediationPlan.actionLaneQueue,
    options,
  });
  const laneIntentCandidateReport = buildLaneIntentCandidateReport({
    selectorReport: {
      generatedAt: now,
      actionLaneQueue: dryRunRemediationPlan.actionLaneQueue,
    },
    laneHandlerReport,
    readinessReport: options.readiness || {},
    now,
  });
  return {
    laneHandlerReport,
    laneHandlerPilot: laneHandlerPilotSummary(laneHandlerReport),
    laneIntentCandidateReport,
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
    ...normalizeAggressiveVelocityCandidates({ ...options, activeCapitalUsd }),
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
        ...(selectedCandidate.signerIntentAvailability || {}),
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

  attachLifecycleEvidence(candidates, options, now);
  const noTradeTable = buildNoTradeTable(candidates);
  attachNextLegalCapitalAction(candidates);
  const policyAttempted = selectedCandidate !== null;
  const noBroadcastReason = policyAttempted
    ? selectedCandidate.policyResult?.decision === "ALLOW"
      ? "selector_policy_attempt_only_no_signer_execute"
      : `policy_blocked:${first(selectedCandidate.policyResult?.blockers, "unknown")}`
    : "no_positive_ev_policy_eligible_candidate";
  const familyCoverage = buildFamilyCoverage(candidates, options, selectedCandidate);
  const claimHarvestSummary = buildClaimHarvestSummary(options);
  const paybackAttributionSummary = buildPaybackAttributionSummary(options);
  const familyActionTable = computeFamilyActionTable(familyCoverage, candidates, options);
  const dryRunRemediationPlan = buildDryRunRemediationPlan({
    selectorReport: {
      generatedAt: now,
      familyActionTable,
    },
  });
  const { laneHandlerPilot, laneIntentCandidateReport } = buildRemediationLifecycleBundle({
    now,
    dryRunRemediationPlan,
    options,
  });

  return {
    generatedAt: now,
    status: policyAttempted ? "POLICY_ATTEMPTED" : "NO_TRADE",
    sourceCoverage: sourceCoverage(candidates),
    familyCoverage,
    familyActionTable,
    actionLaneQueue: dryRunRemediationPlan.actionLaneQueue,
    actionLaneSummary: {
      status: dryRunRemediationPlan.status,
      laneCounts: dryRunRemediationPlan.laneCounts,
      familyCount: dryRunRemediationPlan.familyCount,
      actionItemCount: dryRunRemediationPlan.actionItemCount,
      familiesAssignedExactlyOnce: dryRunRemediationPlan.familiesAssignedExactlyOnce,
      safety: dryRunRemediationPlan.safety,
    },
    laneHandlerPilot,
    laneIntentCandidateSummary: laneIntentCandidateReport.laneIntentCandidateSummary,
    laneIntentCandidates: laneIntentCandidateReport.laneIntentCandidates,
    laneBacklog: laneIntentCandidateReport.laneBacklog,
    laneWaitlist: laneIntentCandidateReport.laneWaitlist,
    laneHandlerCoverage: laneIntentCandidateReport.laneHandlerCoverage,
    laneSafetyProof: laneIntentCandidateReport.laneSafetyProof,
    futureHandlerBacklog: laneIntentCandidateReport.futureHandlerBacklog,
    laneIntentCandidateReport,
    claimHarvestSummary,
    paybackAttributionSummary,
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
