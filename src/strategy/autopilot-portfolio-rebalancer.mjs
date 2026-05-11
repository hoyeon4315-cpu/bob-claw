// Autopilot portfolio rebalancer
// Dormant until capital meets minimum threshold.
// On each tick:
//   1. Scan current positions from Merkl portfolio
//   2. Evaluate against top opportunities
//   3. Generate rebalance intents if improvement > threshold
//   4. Detect new capital deposits and auto-allocate
//
// NEVER signs directly. Emits intents only. Signer Daemon handles execution.

import { parseArgs } from "node:util";
import { buildDiversifiedPortfolio, evaluateRebalance } from "./portfolio-allocator.mjs";
import { computeExtendedNetBtcApy, rankAllChains } from "./extended-chain-router.mjs";
import { getProtocolTier, computeRiskAdjustedScore } from "../config/protocol-trust-tiers.mjs";
import { evaluateOpportunityPolicy } from "../executor/policy/opportunity-policy.mjs";
import { OPPORTUNITY_INTEGRATION } from "../config/opportunity-integration.mjs";
import { SCHEDULE, isIdleWindow } from "../config/opportunity-scheduler.mjs";
import { reconcilePositions } from "../executor/health/position-reconciler.mjs";
import { loadRuntimeRiskContext } from "../executor/runtime/risk-context.mjs";

const BTC_PRICE_USD = 76730;  // Validated against Odos spot quote (2026-04-28)
const MIN_NEW_CAPITAL_USD = 30;    // Micro-test policy allows $30 / 6%
const MIN_REBALANCE_IMPROVEMENT_BPS = 100; // 1% APY
const MAX_GAS_COST_PCT_OF_CAPITAL = 0.05;  // Don't spend >5% on gas

const SIGNER_ADDRESS = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";

// Price map for converting balances to USD
// Updated 2026-04-28: cbBTC validated at $76,730 via Odos (was $95,000 illusion)
const PRICE_MAP = {
  ETH: 2_300,
  WETH: 2_300,
  BTC: 76_730,
  WBTC: 76_730,
  cbBTC: 76_730,
  "wBTC.OFT": 76_730,
  USDC: 1,
  USDT: 1,
  RLUSD: 1,
  AERO: 0.5,
  BNB: 600,
  WBNB: 600,
  AVAX: 22,
  BERA: 5,
};

const PROTOCOL_CONFIGS = [
  {
    reader: "yoProtocol",
    chain: "base",
    params: {
      vaultAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
  },
  // Moonwell Base — operator memory 2026-04-27 records ~$128 cbBTC supply position.
  // mTokens are public canonical contracts; reader returns empty rows when balance is zero.
  {
    reader: "moonwell",
    chain: "base",
    params: {
      marketAddresses: {
        mWETH: "0x628ff693426583D9a7FB391E54366292F509D457",
        mUSDC: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
        mUSDbC: "0x703843C3379b52F9FF486c9f5892218d2a065cC8",
        mcbBTC: "0xF877ACaFA28c19b96727966690b2f44d35aD5976",
      },
    },
  },
  // Aave V3 Ethereum mainnet — operator memory records ~$25 RLUSD position on Horizon market.
  // Horizon is a separate Aave V3 deployment; main-pool aTokens cover USDC/WETH/WBTC paths.
  {
    reader: "aaveV3",
    chain: "ethereum",
    params: {
      aTokens: {
        aEthUSDC: "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c",
        aEthWETH: "0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8",
        aEthWBTC: "0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8",
        aEthUSDT: "0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a",
      },
    },
  },
  // Aave V3 Base — common bluechip aTokens for coverage.
  {
    reader: "aaveV3",
    chain: "base",
    params: {
      aTokens: {
        aBasUSDC: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
        aBasWETH: "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7",
        aBascbBTC: "0xE91D153E0b41518A2Ce8Dd3D7944Fa863463A97d",
      },
    },
  },
];

async function getReconciledPositions() {
  try {
    const result = await reconcilePositions({
      signerAddress: SIGNER_ADDRESS,
      priceMap: PRICE_MAP,
      protocolConfigs: PROTOCOL_CONFIGS,
      useRpc: true,
      useFallback: false, // Never use Zerion/API fallback — RPC only
    });
    return result.positions;
  } catch (e) {
    // RPC failure (rate limit, etc) — return empty positions rather than block the autopilot
    return [];
  }
}

async function getTotalCapitalUsd(overrideUsd = null) {
  if (overrideUsd) return overrideUsd;

  try {
    const result = await reconcilePositions({
      signerAddress: SIGNER_ADDRESS,
      priceMap: PRICE_MAP,
      protocolConfigs: PROTOCOL_CONFIGS,
      useRpc: true,
      useFallback: false,
    });
    return result.totalCapital;
  } catch (e) {
    return 0;
  }
}

function detectNewCapital(currentPositions, previousPositions) {
  const currentTotal = currentPositions.reduce((s, p) => s + (p.allocatedUsd || 0), 0);
  const prevTotal = previousPositions.reduce((s, p) => s + (p.allocatedUsd || 0), 0);
  return Math.max(0, currentTotal - prevTotal);
}

async function fetchCurrentOpportunities() {
  try {
    const res = await fetch("https://yields.llama.fi/pools", { headers: { Accept: "application/json" } });
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : json;

    const safeProjects = new Set([
      "aave-v3", "compound-v3", "morpho", "morpho-blue",
      "aerodrome", "aerodrome-v1", "aerodrome-slipstream",
      "uniswap-v3", "uniswap-v4", "curve", "curve-dex", "balancer-v2",
      "beefy", "pendle", "gmx-v2", "gmx-v2-perps", "moonwell", "superform",
      "yo-protocol", "fluid-lending", "spark-savings", "venus",
    ]);

    return data
      .filter((p) => {
        const sym = (p.symbol || "").toLowerCase();
        const isBtc = sym.includes("btc") || sym.includes("wbtc") || sym.includes("cbbtc");
        const isStable = p.stablecoin === true;
        if (!isBtc && !isStable) return false;
        if (p.apy <= 0.5) return false;
        if (p.tvlUsd < 500_000) return false;
        if (p.apy > 1000) return false;
        if (p.apy > 100 && p.tvlUsd < 2_000_000) return false;
        if (!safeProjects.has(p.project?.toLowerCase())) return false;
        return true;
      })
      .map((p) => ({
        chain: p.chain,
        protocol: p.project,
        symbol: p.symbol,
        pool: p.pool,
        apy: p.apy,
        apyBase: p.apyBase,
        apyReward: p.apyReward,
        tvlUsd: p.tvlUsd,
        isStable: p.stablecoin === true,
      }));
  } catch (e) {
    console.error("fetchCurrentOpportunities failed:", e.message);
    return [];
  }
}

export async function runAutopilotTick({
  previousPositions = null,
  totalCapitalBtc = null,
  totalCapitalUsdOverride = null,
  dryRun = true,
  now = new Date().toISOString(),
  fetchOpportunitiesImpl = fetchCurrentOpportunities,
  loadRuntimeRiskContextImpl = loadRuntimeRiskContext,
} = {}) {
  const nowDate = new Date(now);
  const observedAt = Number.isFinite(nowDate.getTime()) ? nowDate.toISOString() : new Date().toISOString();

  // 0. Integration gate
  if (!OPPORTUNITY_INTEGRATION.enabled) {
    return { status: "dormant", reason: "opportunity_integration_disabled", at: observedAt };
  }

  // 1. Idle window check
  if (isIdleWindow(new Date(observedAt))) {
    return { status: "idle_window", reason: "maintenance_quiet_hours", at: observedAt };
  }

  // Resolve positions: on-chain RPC + protocol contract reads (no API fallback)
  let resolvedPositions = Array.isArray(previousPositions) ? previousPositions : null;
  if (!resolvedPositions) {
    resolvedPositions = await getReconciledPositions();
  }

  // 2. Capital check (on-chain only, no Zerion)
  // Only query on-chain capital when no override is provided
  let capitalBtc, capitalUsd;
  if (totalCapitalUsdOverride != null) {
    capitalUsd = totalCapitalUsdOverride;
    capitalBtc = capitalUsd / BTC_PRICE_USD;
  } else if (totalCapitalBtc != null) {
    capitalBtc = totalCapitalBtc;
    capitalUsd = capitalBtc * BTC_PRICE_USD;
  } else {
    const knownCapitalUsd = await getTotalCapitalUsd();
    capitalUsd = knownCapitalUsd;
    capitalBtc = capitalUsd / BTC_PRICE_USD;
  }

  if (capitalUsd < MIN_NEW_CAPITAL_USD) {
    return {
      status: "insufficient_capital",
      reason: `total_${capitalUsd.toFixed(2)}_usd_below_minimum_${MIN_NEW_CAPITAL_USD}`,
      at: now,
      capitalUsd,
    };
  }

  // 3. Fetch opportunities
  const opportunities = await fetchOpportunitiesImpl();
  if (opportunities.length === 0) {
    return { status: "no_opportunities", at: now };
  }

  // 4. Build optimal portfolio
  const targetCount = capitalUsd < 500 ? 3 : 5;
  const optimal = buildDiversifiedPortfolio({
    opportunities,
    totalCapitalBtc: capitalBtc,
    targetOpportunityCount: targetCount,
  });

  // 5. Evaluate rebalance against current positions
  const currentAsOpp = resolvedPositions.map((p) => ({
    chain: p.chain,
    protocol: p.protocol,
    symbol: p.symbol,
    pool: p.pool,
    apy: p.apy,
    tvlUsd: 1_000_000, // placeholder
  }));

  const rebalance = evaluateRebalance({
    currentPortfolio: currentAsOpp.map((o) => ({
      opportunity: o,
      allocatedBtc: (o.allocatedUsd || 0) / BTC_PRICE_USD,
      expectedNetApy: o.apy * 0.8, // rough net estimate
    })),
    newOpportunities: opportunities,
    totalCapitalBtc: capitalBtc,
    lastRebalanceDays: 7, // assume last rebalance was 7 days ago
  });

  // 6. Detect new capital
  const newCapitalUsd = detectNewCapital(optimal.allocations, resolvedPositions);

  // 7. Generate intents
  const intents = [];

  // 7a. Exit underperforming positions
  for (const m of rebalance.migrations || []) {
    if (m.action === "exit") {
      intents.push({
        type: "exit",
        opportunity: m.opportunity,
        amountBtc: m.amountBtc,
        reason: m.reason,
        chain: m.opportunity?.chain,
        estimatedGasUsd: 0.12,
      });
    }
  }

  // 7b. Enter new high-score opportunities (only if new capital or rebalanced freed capital)
  for (const alloc of optimal.allocations) {
    const existing = resolvedPositions.find((p) => p.pool === alloc.opportunity.pool);
    if (!existing && alloc.allocatedBtc * BTC_PRICE_USD >= MIN_NEW_CAPITAL_USD) {
      intents.push({
        type: "enter",
        opportunity: alloc.opportunity,
        amountBtc: alloc.allocatedBtc,
        expectedNetApy: alloc.expectedNetApy,
        reason: "optimal_portfolio_allocation",
        chain: alloc.opportunity.chain,
        protocol: alloc.opportunity.protocol,
        estimatedGasUsd: alloc.chain === "Ethereum" ? 8.0 : 0.12,
      });
    }
  }

  // 7c. Reallocate existing positions (size adjustments)
  for (const alloc of optimal.allocations) {
    const existing = resolvedPositions.find((p) => p.pool === alloc.opportunity.pool);
    if (existing) {
      const diffBtc = alloc.allocatedBtc - (existing.allocatedUsd / BTC_PRICE_USD);
      if (Math.abs(diffBtc) * BTC_PRICE_USD > 50) { // >$50 change
        intents.push({
          type: diffBtc > 0 ? "increase" : "decrease",
          opportunity: alloc.opportunity,
          amountBtc: Math.abs(diffBtc),
          reason: "size_rebalancing",
          chain: alloc.opportunity.chain,
        });
      }
    }
  }

  // 8. Policy gate each intent
  const gatedIntents = [];
  const runtimeRiskContext = await loadRuntimeRiskContextImpl({
    activeBudgetUsd: capitalUsd,
    now: observedAt,
  });
  const currentAllocations = runtimeRiskContext?.currentAllocations || {};
  for (const intent of intents) {
    const amountUsd = intent.amountBtc * BTC_PRICE_USD;
    const policyResult = await evaluateOpportunityPolicy({
      intent: {
        strategyId: "autopilot-portfolio",
        ...intent,
        amountUsd,
        sharePct: capitalUsd > 0 ? amountUsd / capitalUsd : 0,
        opportunityId: intent.opportunity?.pool || intent.opportunity?.opportunityId || null,
        srcChain: intent.chain,
        dstChain: intent.chain,
        apr: intent.opportunity?.apy || 0,
        expectedHoldDays: 14,
        estimatedGasCostUsd: intent.estimatedGasUsd || 0.12,
        roundTripSuccessRate: 0.95,
        observedAt,
      },
      currentAllocations,
      capitalState: { totalDeployableCapital: capitalUsd },
      now: observedAt,
    });

    if (policyResult.decision === "ALLOW") {
      gatedIntents.push({ ...intent, policy: "ALLOW" });
    } else {
      gatedIntents.push({ ...intent, policy: "BLOCK", blockers: policyResult.blockers });
    }
  }

  const approved = gatedIntents.filter((i) => i.policy === "ALLOW");
  const blocked = gatedIntents.filter((i) => i.policy === "BLOCK");
  
  // Ensure all intents have policy field for tests
  for (const intent of gatedIntents) {
    if (!intent.policy) intent.policy = "BLOCK";
  }

  // 9. Return tick result
  return {
    status: "completed",
    at: observedAt,
    capitalUsd,
    capitalBtc,
    opportunityCount: opportunities.length,
    weightedNetApy: optimal.weightedNetApy,
    newCapitalUsd,
    shouldRebalance: rebalance.shouldRebalance,
    rebalanceReason: rebalance.reason,
    intents: gatedIntents,
    approvedCount: approved.length,
    blockedCount: blocked.length,
    dryRun,
    nextTickHours: SCHEDULE.intervalHours,
  };
}

// CLI entry
async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean" },
      "capital-btc": { type: "string" },
      "capital-usd": { type: "string" },
      loop: { type: "boolean" },
    },
    allowPositionals: true,
  });

  const dryRun = values["dry-run"] !== false; // default dry-run
  const capitalBtc = values["capital-btc"] ? parseFloat(values["capital-btc"]) : null;
  const capitalUsd = values["capital-usd"] ? parseFloat(values["capital-usd"]) : null;
  const loop = values.loop || false;

  async function tick() {
    const result = await runAutopilotTick({ totalCapitalBtc: capitalBtc, totalCapitalUsdOverride: capitalUsd, dryRun });
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (loop) {
    console.error(`Autopilot loop starting. Interval: ${SCHEDULE.intervalHours}h. Press Ctrl+C to stop.`);
    while (true) {
      await tick();
      const waitMs = SCHEDULE.intervalHours * 60 * 60 * 1000;
      console.error(`Waiting ${SCHEDULE.intervalHours} hours...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  } else {
    await tick();
  }
}

if (import.meta.url?.endsWith(process.argv[1]) || import.meta.url?.replace("file://", "") === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
