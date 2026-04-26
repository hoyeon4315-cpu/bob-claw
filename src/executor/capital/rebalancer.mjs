import { ZERO_TOKEN, WBTC_OFT_TOKEN, normalizeToken, tokenAsset, unitsToDecimal } from "../../assets/tokens.mjs";
import { priceForAssetUsd } from "../../market/prices.mjs";
import { buildFundingSourcePlan } from "../../treasury/funding-source-planner.mjs";
import { decimalToUnits } from "../../treasury/policy.mjs";
import { buildTreasuryRefillJobs } from "../../treasury/refill-job.mjs";
import { evaluateGasFloatKeeper } from "./gas-float-keeper.mjs";
import { buildTargetBalances } from "./target-balances.mjs";

const SETTLEMENT_FAMILIES = new Set(["wrapped_btc", "stablecoin"]);
export const DEFAULT_SETTLEMENT_TOKEN_BY_CHAIN = Object.freeze({
  avalanche: WBTC_OFT_TOKEN,
  base: WBTC_OFT_TOKEN,
  bera: WBTC_OFT_TOKEN,
  bob: WBTC_OFT_TOKEN,
  bsc: WBTC_OFT_TOKEN,
  ethereum: WBTC_OFT_TOKEN,
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
  const gasFloat = evaluateGasFloatKeeper({
    targetBalances: targets,
    balancesByChain,
    now,
  });
  const actions = [...gasFloat.actions];
  const tolerance = Number.isFinite(policy?.capital?.rebalanceToleranceUsd)
    ? policy.capital.rebalanceToleranceUsd
    : 5;

  const targetByChain = new Map();
  const shortfalls = [];
  const surpluses = [];

  for (const item of targets.items || []) {
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

  const matchedTransfers = buildCapitalRebalanceMatchedTransfers({ shortfalls, surpluses });
  const matchedSourceUsdByChain = new Map();
  for (const transfer of matchedTransfers) {
    matchedSourceUsdByChain.set(
      transfer.from,
      (matchedSourceUsdByChain.get(transfer.from) || 0) + transfer.amountUsd,
    );
  }

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

  return {
    schemaVersion: 1,
    observedAt: now,
    decision: actions.length > 0 ? "REBALANCE_REQUIRED" : "BALANCED",
    targets,
    gasFloat,
    actions,
    matchedTransfers,
    surpluses,
    shortfalls,
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
      const settlementToken = settlementTokenByChain?.[item.chain] || null;
      if (!settlementToken) {
        blockers.push({
          type: "settlement_token_unconfigured",
          chain: item.chain,
          amountUsd: item.amountUsd,
        });
        continue;
      }
      const { action, blocker } = refillActionForUsdShortfall({
        type: "refill_token",
        chain: item.chain,
        token: settlementToken,
        amountUsd: item.amountUsd,
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
  const rebalancePlan = buildCapitalRebalancePlan({ strategyCaps, policy, balancesByChain, scoredTargets, now });
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
