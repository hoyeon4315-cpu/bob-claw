import { ETHEREUM_WBTC_TOKEN, ZERO_TOKEN, WBTC_OFT_TOKEN, normalizeToken, tokenAsset, unitsToDecimal } from "../../assets/tokens.mjs";
import { priceForAssetUsd } from "../../market/prices.mjs";
import { buildFundingSourcePlan } from "../../treasury/funding-source-planner.mjs";
import { decimalToUnits } from "../../treasury/policy.mjs";
import { buildTreasuryRefillJobs } from "../../treasury/refill-job.mjs";
import { activeChainSet } from "./active-chain-set.mjs";
import { evaluateGasFloatKeeper } from "./gas-float-keeper.mjs";
import { buildTargetBalances } from "./target-balances.mjs";

const SETTLEMENT_FAMILIES = new Set(["wrapped_btc", "stablecoin"]);
const CONSOLIDATION_SOURCE_FAMILIES = new Set(["wrapped_btc", "stablecoin", "native_or_wrapped"]);
export const DEFAULT_RESERVE_CHAIN = "base";
export const DEFAULT_RESERVE_CHAIN_TARGET_WALLET_SHARE = 0.8;
export const DEFAULT_RESERVE_CONCENTRATION_TOLERANCE_USD = 0.5;
export const DEFAULT_SETTLEMENT_TOKEN_BY_CHAIN = Object.freeze({
  avalanche: WBTC_OFT_TOKEN,
  base: WBTC_OFT_TOKEN,
  bera: WBTC_OFT_TOKEN,
  bob: WBTC_OFT_TOKEN,
  bsc: WBTC_OFT_TOKEN,
  ethereum: ETHEREUM_WBTC_TOKEN,
  optimism: WBTC_OFT_TOKEN,
  sei: WBTC_OFT_TOKEN,
  soneium: WBTC_OFT_TOKEN,
  sonic: WBTC_OFT_TOKEN,
  unichain: WBTC_OFT_TOKEN,
});

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function inventoryKey(chain, token = ZERO_TOKEN) {
  return `${chain}:${normalizeToken(token)}`;
}

function normalizedNativeRecord(item = {}) {
  const asset = tokenAsset(item.chain, ZERO_TOKEN);
  return {
    ...item,
    chain: item.chain,
    token: ZERO_TOKEN,
    asset: item.asset || item.ticker || asset.ticker,
    ticker: item.ticker || item.asset || asset.ticker,
    actual: item.actual ?? item.balance ?? "0",
    actualDecimal: finite(item.actualDecimal) ?? 0,
    estimatedUsd: finite(item.estimatedUsd),
  };
}

function normalizedTokenRecord(item = {}) {
  const asset = tokenAsset(item.chain, item.token);
  return {
    ...item,
    chain: item.chain,
    token: item.token,
    ticker: item.ticker || asset.ticker,
    actual: item.actual ?? item.balance ?? "0",
    actualDecimal: finite(item.actualDecimal) ?? 0,
    estimatedUsd: finite(item.estimatedUsd),
  };
}

function upsertInventoryRecord(map, key, value) {
  if (!value?.chain) return;
  map.set(key, value);
}

function ceilUnitsFromDecimal(decimalAmount, decimals) {
  if (!Number.isFinite(decimalAmount) || !(decimalAmount > 0) || !Number.isInteger(decimals) || decimals < 0) return null;
  const precision = Math.min(decimals, 9);
  const roundedUp = Math.ceil((decimalAmount + Number.EPSILON) * 10 ** precision) / 10 ** precision;
  return decimalToUnits(roundedUp.toFixed(precision), decimals).toString();
}

function refillActionForUsdShortfall({ type, chain, token = ZERO_TOKEN, amountUsd, currentUsd = 0, targetUsd = 0, prices, rationale, origin = null }) {
  const asset = tokenAsset(chain, token);
  const priceUsd = priceForAssetUsd(asset, prices);
  if (!Number.isFinite(amountUsd) || !(amountUsd > 0)) {
    return { action: null, blocker: null };
  }
  if (!Number.isFinite(priceUsd) || !(priceUsd > 0)) {
    return {
      action: null,
      blocker: {
        type: "asset_price_missing",
        chain,
        token,
        ticker: asset.ticker,
        amountUsd,
        rationale,
      },
    };
  }
  const refillAmountDecimal = amountUsd / priceUsd;
  const refillAmount = ceilUnitsFromDecimal(refillAmountDecimal, asset.decimals);
  if (!refillAmount) {
    return {
      action: null,
      blocker: {
        type: "asset_unit_conversion_failed",
        chain,
        token,
        ticker: asset.ticker,
        amountUsd,
        rationale,
      },
    };
  }
  return {
    action: {
      type,
      chain,
      ...(type === "refill_native" ? { asset: asset.ticker } : { ticker: asset.ticker }),
      token,
      currentUsd,
      targetUsd,
      refillAmount,
      refillAmountDecimal: unitsToDecimal(BigInt(refillAmount), asset.decimals),
      refillEstimatedUsd: amountUsd,
      rationale,
      ...(origin ? { origin } : {}),
    },
    blocker: null,
  };
}

export function buildCapitalRebalanceMatchedTransfers({ shortfalls = [], surpluses = [] } = {}) {
  const transfers = [];
  const sf = shortfalls.map((entry) => ({ ...entry }));
  const su = surpluses.map((entry) => ({ ...entry }));
  sf.sort((a, b) => (b.amountUsd || 0) - (a.amountUsd || 0));
  su.sort((a, b) => (b.amountUsd || 0) - (a.amountUsd || 0));
  let i = 0;
  let j = 0;
  while (i < sf.length && j < su.length) {
    const need = sf[i];
    const have = su[j];
    if (!(need.amountUsd > 0)) {
      i += 1;
      continue;
    }
    if (!(have.amountUsd > 0)) {
      j += 1;
      continue;
    }
    if (need.chain === have.chain) {
      j += 1;
      continue;
    }
    const moveUsd = Math.min(need.amountUsd, have.amountUsd);
    transfers.push({
      from: have.chain,
      to: need.chain,
      amountUsd: moveUsd,
      sourceToken: have.token || null,
      sourceTicker: have.ticker || null,
      sourceKind: have.sourceKind || null,
      sourceActual: have.actual ?? null,
      sourceActualDecimal: have.actualDecimal ?? null,
      sourceEstimatedUsd: finite(have.currentUsd) ?? finite(have.estimatedUsd),
      sourceHoldbackUsd: finite(have.holdbackUsd),
      sourceResidualUsd: Math.max(0, (have.amountUsd || 0) - moveUsd),
      reason: need.reason || null,
      currentUsd: finite(need.currentUsd) ?? 0,
      targetUsd: finite(need.targetUsd),
      targetWalletUsd: finite(need.targetWalletUsd),
      targetWalletShare: finite(need.targetWalletShare),
    });
    need.amountUsd -= moveUsd;
    have.amountUsd -= moveUsd;
    if (need.amountUsd <= 0) i += 1;
    if (have.amountUsd <= 0) j += 1;
  }
  return transfers;
}

export function buildCapitalRebalancePlan({
  strategyCaps,
  policy = null,
  balancesByChain = {},
  scoredTargets = null,
  inventory = null,
  prices = null,
  now = new Date().toISOString(),
} = {}) {
  const targets = scoredTargets && scoredTargets.perChain
    ? {
        schemaVersion: 1,
        observedAt: scoredTargets.observedAt || now,
        items: (scoredTargets.perChain || []).map((entry) => ({
          chain: entry.chain,
          strategyIds: entry.strategyIds || [],
          settlementTargetUsd: entry.settlementTargetUsd || 0,
          gasFloatMinUsd: 0,
          gasFloatTargetUsd: 0,
        })),
        summary: {
          chainCount: (scoredTargets.perChain || []).length,
          totalSettlementTargetUsd: (scoredTargets.perChain || []).reduce(
            (sum, entry) => sum + (entry.settlementTargetUsd || 0),
            0,
          ),
          totalGasFloatTargetUsd: 0,
        },
        scored: true,
      }
    : buildTargetBalances({ strategyCaps, policy, now });
  const activeDestinationChains = activeChainSet(strategyCaps);
  const gasFloat = evaluateGasFloatKeeper({
    targetBalances: targets,
    balancesByChain,
    now,
    activeChainSet: activeDestinationChains,
  });
  const tolerance = Number.isFinite(policy?.capital?.rebalanceToleranceUsd)
    ? policy.capital.rebalanceToleranceUsd
    : 5;
  const reserveConcentration = buildReserveConcentrationPlan({
    inventory,
    policy,
    prices,
    tolerance,
  });
  const actions = reserveConcentration.active
    ? [...gasFloat.actions.filter((item) => item.chain === reserveConcentration.reserveChain)]
    : [...gasFloat.actions];

  const targetByChain = new Map();
  const shortfalls = [];
  const surpluses = [];

  if (reserveConcentration.active) {
    shortfalls.push({
      chain: reserveConcentration.reserveChain,
      amountUsd: reserveConcentration.shortfallUsd,
      targetUsd: reserveConcentration.targetReserveWalletUsd,
      currentUsd: reserveConcentration.currentReserveWalletUsd,
      targetWalletUsd: reserveConcentration.targetReserveWalletUsd,
      targetWalletShare: reserveConcentration.targetWalletShare,
      reason: "reserve_wallet_share",
    });
    actions.push({
      type: "capital_rebalance",
      chain: reserveConcentration.reserveChain,
      amountUsd: reserveConcentration.shortfallUsd,
      targetUsd: reserveConcentration.targetReserveWalletUsd,
      currentUsd: reserveConcentration.currentReserveWalletUsd,
      reason: "reserve_wallet_share",
      targetWalletShare: reserveConcentration.targetWalletShare,
    });
    surpluses.push(...reserveConcentration.surpluses);
  } else {
    for (const item of targets.items || []) {
      if (!activeDestinationChains.has(item.chain)) continue;
      targetByChain.set(item.chain, item.settlementTargetUsd || 0);
      const currentSettlementUsd = finite(balancesByChain[item.chain]?.settlementUsd) ?? 0;
      const shortfallUsd = Math.max(0, (item.settlementTargetUsd || 0) - currentSettlementUsd);
      if (shortfallUsd > tolerance) {
        shortfalls.push({
          chain: item.chain,
          amountUsd: shortfallUsd,
          targetUsd: item.settlementTargetUsd,
          currentUsd: currentSettlementUsd,
        });
        actions.push({
          type: "capital_rebalance",
          chain: item.chain,
          amountUsd: shortfallUsd,
          targetUsd: item.settlementTargetUsd,
          currentUsd: currentSettlementUsd,
        });
      }
    }

    for (const [chain, balance] of Object.entries(balancesByChain || {})) {
      const targetUsd = targetByChain.get(chain) ?? 0;
      const currentSettlementUsd = finite(balance?.settlementUsd) ?? 0;
      const surplusUsd = currentSettlementUsd - targetUsd;
      if (surplusUsd > tolerance) {
        surpluses.push({
          chain,
          amountUsd: surplusUsd,
          targetUsd,
          currentUsd: currentSettlementUsd,
        });
      }
    }
  }

  const matchedTransfers = reserveConcentration.active
    ? reserveConcentration.matchedTransfers
    : buildCapitalRebalanceMatchedTransfers({ shortfalls, surpluses });
  const matchedSourceUsdByChain = new Map();
  for (const transfer of matchedTransfers) {
    matchedSourceUsdByChain.set(
      transfer.from,
      (matchedSourceUsdByChain.get(transfer.from) || 0) + transfer.amountUsd,
    );
  }

  if (!reserveConcentration.active) {
    for (const surplus of surpluses) {
      const matched = matchedSourceUsdByChain.get(surplus.chain) || 0;
      const residual = surplus.amountUsd - matched;
      if (residual > tolerance) {
        actions.push({
          type: "capital_drain",
          chain: surplus.chain,
          amountUsd: residual,
          currentUsd: surplus.currentUsd,
          targetUsd: surplus.targetUsd,
          matchedToShortfallUsd: matched,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    decision: actions.length > 0 || matchedTransfers.length > 0 ? "REBALANCE_REQUIRED" : "BALANCED",
    targets,
    activeChains: [...activeDestinationChains],
    gasFloat,
    actions,
    matchedTransfers,
    surpluses,
    shortfalls,
    reserveConcentration,
  };
}

export function mergeCapitalInventory({
  treasuryInventory = null,
  wholeWalletInventory = null,
} = {}) {
  const native = new Map();
  const tokens = new Map();

  for (const item of treasuryInventory?.native || []) {
    upsertInventoryRecord(native, inventoryKey(item.chain), normalizedNativeRecord(item));
  }
  for (const item of treasuryInventory?.tokens || []) {
    upsertInventoryRecord(tokens, inventoryKey(item.chain, item.token), normalizedTokenRecord(item));
  }

  for (const item of wholeWalletInventory?.native || []) {
    upsertInventoryRecord(native, inventoryKey(item.chain), normalizedNativeRecord(item));
  }
  for (const item of wholeWalletInventory?.tokenBalances || []) {
    upsertInventoryRecord(tokens, inventoryKey(item.chain, item.token), normalizedTokenRecord(item));
  }

  return {
    native: [...native.values()].sort((left, right) => String(left.chain).localeCompare(String(right.chain))),
    tokens: [...tokens.values()].sort(
      (left, right) =>
        String(left.chain).localeCompare(String(right.chain)) ||
        String(left.ticker || "").localeCompare(String(right.ticker || "")) ||
        String(left.token || "").localeCompare(String(right.token || "")),
    ),
    allowances: treasuryInventory?.allowances || [],
  };
}

export function observedCapitalBalancesByChain({ inventory = null } = {}) {
  const balances = {};

  for (const item of inventory?.native || []) {
    if (!item?.chain) continue;
    const current = balances[item.chain] || { nativeUsd: 0, settlementUsd: 0 };
    current.nativeUsd += finite(item.estimatedUsd) ?? 0;
    balances[item.chain] = current;
  }

  for (const item of inventory?.tokens || []) {
    if (!item?.chain) continue;
    const asset = tokenAsset(item.chain, item.token);
    if (!SETTLEMENT_FAMILIES.has(asset.family)) continue;
    const current = balances[item.chain] || { nativeUsd: 0, settlementUsd: 0 };
    current.settlementUsd += finite(item.estimatedUsd) ?? 0;
    balances[item.chain] = current;
  }

  return balances;
}

export function observedWalletUsdByChain({ inventory = null } = {}) {
  const balances = {};

  for (const item of inventory?.native || []) {
    if (!item?.chain) continue;
    const current = balances[item.chain] || { walletUsd: 0 };
    current.walletUsd += finite(item.estimatedUsd) ?? 0;
    balances[item.chain] = current;
  }

  for (const item of inventory?.tokens || []) {
    if (!item?.chain) continue;
    const current = balances[item.chain] || { walletUsd: 0 };
    current.walletUsd += finite(item.estimatedUsd) ?? 0;
    balances[item.chain] = current;
  }

  return balances;
}

function nativeHoldbackUsd(chain, policy, prices) {
  const minBalanceDecimal = Number(policy?.nativeBalances?.[chain]?.minBalance);
  if (!(Number.isFinite(minBalanceDecimal) && minBalanceDecimal > 0)) return 0;
  const nativePriceUsd = priceForAssetUsd(tokenAsset(chain, ZERO_TOKEN), prices);
  if (!(Number.isFinite(nativePriceUsd) && nativePriceUsd > 0)) return 0;
  return minBalanceDecimal * nativePriceUsd;
}

function buildReserveConsolidationSurpluses({
  inventory = null,
  reserveChain = DEFAULT_RESERVE_CHAIN,
  policy = null,
  prices = null,
  tolerance = 0,
} = {}) {
  const surpluses = [];

  for (const item of inventory?.native || []) {
    if (!item?.chain || item.chain === reserveChain) continue;
    const currentUsd = finite(item.estimatedUsd) ?? 0;
    const holdbackUsd = nativeHoldbackUsd(item.chain, policy, prices);
    const amountUsd = Math.max(0, currentUsd - holdbackUsd);
    if (!(amountUsd > tolerance)) continue;
    surpluses.push({
      chain: item.chain,
      token: ZERO_TOKEN,
      ticker: item.ticker || tokenAsset(item.chain, ZERO_TOKEN).ticker,
      sourceKind: "native",
      actual: item.actual ?? item.balance ?? null,
      actualDecimal: finite(item.actualDecimal),
      currentUsd,
      holdbackUsd,
      amountUsd,
    });
  }

  for (const item of inventory?.tokens || []) {
    if (!item?.chain || item.chain === reserveChain) continue;
    const asset = tokenAsset(item.chain, item.token);
    if (!CONSOLIDATION_SOURCE_FAMILIES.has(asset.family)) continue;
    const currentUsd = finite(item.estimatedUsd) ?? 0;
    if (!(currentUsd > tolerance)) continue;
    surpluses.push({
      chain: item.chain,
      token: item.token,
      ticker: item.ticker || asset.ticker,
      sourceKind: "token",
      actual: item.actual ?? item.balance ?? null,
      actualDecimal: finite(item.actualDecimal),
      currentUsd,
      holdbackUsd: 0,
      amountUsd: currentUsd,
    });
  }

  return surpluses.sort((left, right) => (right.amountUsd || 0) - (left.amountUsd || 0));
}

function buildReserveConcentrationPlan({
  inventory = null,
  policy = null,
  prices = null,
  tolerance = 0,
} = {}) {
  const consolidationTolerance = finite(policy?.capital?.reserveConcentrationToleranceUsd)
    ?? DEFAULT_RESERVE_CONCENTRATION_TOLERANCE_USD;
  const reserveChain = String(policy?.capital?.reserveChain || DEFAULT_RESERVE_CHAIN).toLowerCase();
  const targetWalletShare = finite(policy?.capital?.reserveChainTargetWalletShare)
    ?? DEFAULT_RESERVE_CHAIN_TARGET_WALLET_SHARE;
  const walletUsdByChain = observedWalletUsdByChain({ inventory });
  const totalWalletUsd = Object.values(walletUsdByChain).reduce((sum, item) => sum + (finite(item.walletUsd) ?? 0), 0);
  const currentReserveWalletUsd = finite(walletUsdByChain[reserveChain]?.walletUsd) ?? 0;
  const targetReserveWalletUsd = totalWalletUsd * targetWalletShare;
  const shortfallUsd = Math.max(0, targetReserveWalletUsd - currentReserveWalletUsd);
  if (
    !inventory ||
    !(targetWalletShare > 0 && targetWalletShare < 1) ||
    !(shortfallUsd > consolidationTolerance)
  ) {
    return {
      active: false,
      reserveChain,
      targetWalletShare,
      toleranceUsd: consolidationTolerance,
      walletUsdByChain,
      totalWalletUsd,
      currentReserveWalletUsd,
      targetReserveWalletUsd,
      shortfallUsd,
      surpluses: [],
      matchedTransfers: [],
    };
  }
  const surpluses = buildReserveConsolidationSurpluses({
    inventory,
    reserveChain,
    policy,
    prices,
    tolerance: consolidationTolerance,
  });
  const matchedTransfers = buildCapitalRebalanceMatchedTransfers({
    shortfalls: [
      {
        chain: reserveChain,
        amountUsd: shortfallUsd,
        currentUsd: currentReserveWalletUsd,
        targetUsd: targetReserveWalletUsd,
        targetWalletUsd: targetReserveWalletUsd,
        targetWalletShare,
        reason: "reserve_wallet_share",
      },
    ],
    surpluses,
  });
  return {
    active: matchedTransfers.length > 0,
    reserveChain,
    targetWalletShare,
    toleranceUsd: consolidationTolerance,
    walletUsdByChain,
    totalWalletUsd,
    currentReserveWalletUsd,
    targetReserveWalletUsd,
    shortfallUsd,
    surpluses,
    matchedTransfers,
  };
}

export function buildCapitalRebalanceRefillPlan({
  rebalancePlan,
  prices,
  inventory = null,
  address = null,
  now = rebalancePlan?.observedAt || new Date().toISOString(),
  settlementTokenByChain = DEFAULT_SETTLEMENT_TOKEN_BY_CHAIN,
} = {}) {
  const actions = [];
  const blockers = [];
  const matchedAmountByDestination = new Map();

  for (const transfer of rebalancePlan?.matchedTransfers || []) {
    matchedAmountByDestination.set(
      transfer.to,
      (matchedAmountByDestination.get(transfer.to) || 0) + (transfer.amountUsd || 0),
    );
    const settlementToken = settlementTokenByChain?.[transfer.to] || null;
    if (!settlementToken) {
      blockers.push({
        type: "settlement_token_unconfigured",
        chain: transfer.to,
        amountUsd: transfer.amountUsd,
      });
      continue;
    }
    const { action, blocker } = refillActionForUsdShortfall({
      type: "refill_token",
      chain: transfer.to,
      token: settlementToken,
      amountUsd: transfer.amountUsd,
      currentUsd: transfer.currentUsd,
      targetUsd: transfer.targetUsd,
      prices,
      rationale: `Capital Manager matched transfer from ${transfer.from} into ${transfer.to}.`,
      origin: "capital_rebalance_matched_transfer",
    });
    if (action) {
      actions.push({
        ...action,
        sourceHint: {
          chain: transfer.from,
          token: transfer.sourceToken || null,
          ticker: transfer.sourceTicker || null,
          sourceKind: transfer.sourceKind || null,
          amountUsd: transfer.amountUsd,
          estimatedUsd: transfer.sourceEstimatedUsd ?? null,
          actual: transfer.sourceActual ?? null,
          actualDecimal: transfer.sourceActualDecimal ?? null,
          holdbackUsd: transfer.sourceHoldbackUsd ?? null,
          reason: transfer.reason || null,
        },
      });
    }
    if (blocker) blockers.push(blocker);
  }

  for (const item of rebalancePlan?.actions || []) {
    if (item.type === "gas_float_top_up") {
      const { action, blocker } = refillActionForUsdShortfall({
        type: "refill_native",
        chain: item.chain,
        token: ZERO_TOKEN,
        amountUsd: item.amountUsd,
        currentUsd: item.currentUsd,
        targetUsd: item.targetUsd,
        prices,
        rationale: "Capital Manager gas float keeper target shortfall.",
        origin: "gas_float_keeper",
      });
      if (action) actions.push(action);
      if (blocker) blockers.push(blocker);
      continue;
    }

    if (item.type === "capital_rebalance") {
      const residualAmountUsd = Math.max(0, (item.amountUsd || 0) - (matchedAmountByDestination.get(item.chain) || 0));
      if (!(residualAmountUsd > 0)) continue;
      const settlementToken = settlementTokenByChain?.[item.chain] || null;
      if (!settlementToken) {
        blockers.push({
          type: "settlement_token_unconfigured",
          chain: item.chain,
          amountUsd: residualAmountUsd,
        });
        continue;
      }
      const { action, blocker } = refillActionForUsdShortfall({
        type: "refill_token",
        chain: item.chain,
        token: settlementToken,
        amountUsd: residualAmountUsd,
        currentUsd: item.currentUsd,
        targetUsd: item.targetUsd,
        prices,
        rationale: "Capital Manager settlement reserve shortfall.",
      });
      if (action) actions.push(action);
      if (blocker) blockers.push(blocker);
    }
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    address,
    decision: actions.length > 0 ? "REFILL_REQUIRED" : blockers.length > 0 ? "REVIEW_REFILL_PLAN" : "BALANCED",
    inventory: inventory || { native: [], tokens: [], allowances: [] },
    actions,
    blockers,
    summary: {
      actionCount: actions.length,
      blockerCount: blockers.length,
      estimatedAssetValueUsd: actions.reduce((sum, item) => sum + (finite(item.refillEstimatedUsd) ?? 0), 0),
    },
    rebalancePlan,
  };
}

export function buildCapitalManagerRefillJobs({
  strategyCaps,
  policy,
  treasuryInventory = null,
  wholeWalletInventory = null,
  prices,
  address = null,
  routeContext = null,
  routeCandidates = [],
  supplementalInventory = null,
  settlementTokenByChain = DEFAULT_SETTLEMENT_TOKEN_BY_CHAIN,
  scoredTargets = null,
  now = new Date().toISOString(),
} = {}) {
  const inventory = mergeCapitalInventory({ treasuryInventory, wholeWalletInventory });
  const balancesByChain = observedCapitalBalancesByChain({ inventory });
  const rebalancePlan = buildCapitalRebalancePlan({
    strategyCaps,
    policy,
    balancesByChain,
    scoredTargets,
    inventory,
    prices,
    now,
  });
  const capitalPlan = buildCapitalRebalanceRefillPlan({
    rebalancePlan,
    prices,
    inventory,
    address,
    now,
    settlementTokenByChain,
  });
  const fundingSourcePlan = buildFundingSourcePlan({
    plan: capitalPlan,
    policy,
    routeContext,
    supplementalInventory: supplementalInventory || wholeWalletInventory,
  });
  const jobs = buildTreasuryRefillJobs({
    plan: capitalPlan,
    policy,
    fundingSourcePlan,
    routeCandidates,
  });

  return {
    schemaVersion: 1,
    observedAt: now,
    inventory,
    balancesByChain,
    rebalancePlan,
    capitalPlan,
    fundingSourcePlan,
    jobs,
  };
}
