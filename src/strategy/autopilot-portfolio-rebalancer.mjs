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
import { getProtocolTier } from "../config/protocol-trust-tiers.mjs";
import { evaluateOpportunityPolicy } from "../executor/policy/opportunity-policy.mjs";
import { OPPORTUNITY_INTEGRATION } from "../config/opportunity-integration.mjs";
import { SCHEDULE, isIdleWindow } from "../config/opportunity-scheduler.mjs";

const BTC_PRICE_USD = 95000;
const MIN_NEW_CAPITAL_USD = 500;    // Don't act on less than $500
const MIN_REBALANCE_IMPROVEMENT_BPS = 100; // 1% APY
const MAX_GAS_COST_PCT_OF_CAPITAL = 0.05;  // Don't spend >5% on gas

// Current known operator positions from AGENTS.md Operator Memory
// These are read-only; the autopilot never mutates them directly.
const KNOWN_POSITIONS = [
  { chain: "Base", protocol: "yo-protocol", symbol: "USDC", allocatedUsd: 75, pool: "yo-base-usdc", apy: 15.69 },
  { chain: "Ethereum", protocol: "aave-v3", symbol: "RLUSD", allocatedUsd: 25, pool: "aave-eth-rlusd", apy: 3.45 },
  { chain: "Ethereum", protocol: "morpho-blue", symbol: "USDC", allocatedUsd: 75, pool: "morpho-clearstar", apy: 4.09 },
  { chain: "Ethereum", protocol: "morpho-blue", symbol: "USDC", allocatedUsd: 50, pool: "morpho-steakhouse", apy: 4.09 },
];

function totalKnownCapitalUsd() {
  return KNOWN_POSITIONS.reduce((s, p) => s + p.allocatedUsd, 0);
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
      "yo-protocol", "fluid-lending", "spark-savings",
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
  previousPositions = KNOWN_POSITIONS,
  totalCapitalBtc = null,
  dryRun = true,
} = {}) {
  const now = new Date().toISOString();

  // 0. Integration gate
  if (!OPPORTUNITY_INTEGRATION.enabled) {
    return { status: "dormant", reason: "opportunity_integration_disabled", at: now };
  }

  // 1. Idle window check
  if (isIdleWindow()) {
    return { status: "idle_window", reason: "maintenance_quiet_hours", at: now };
  }

  // 2. Capital check
  const knownCapitalUsd = totalKnownCapitalUsd();
  const capitalBtc = totalCapitalBtc ?? knownCapitalUsd / BTC_PRICE_USD;
  const capitalUsd = capitalBtc * BTC_PRICE_USD;

  if (capitalUsd < MIN_NEW_CAPITAL_USD) {
    return {
      status: "insufficient_capital",
      reason: `total_${capitalUsd.toFixed(2)}_usd_below_minimum_${MIN_NEW_CAPITAL_USD}`,
      at: now,
      capitalUsd,
    };
  }

  // 3. Fetch opportunities
  const opportunities = await fetchCurrentOpportunities();
  if (opportunities.length === 0) {
    return { status: "no_opportunities", at: now };
  }

  // 4. Build optimal portfolio
  const optimal = buildDiversifiedPortfolio({
    opportunities,
    totalCapitalBtc: capitalBtc,
    targetOpportunityCount: 5,
  });

  // 5. Evaluate rebalance against current positions
  const currentAsOpp = previousPositions.map((p) => ({
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
  const newCapitalUsd = detectNewCapital(optimal.allocations, previousPositions);

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
    const existing = previousPositions.find((p) => p.pool === alloc.opportunity.pool);
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
    const existing = previousPositions.find((p) => p.pool === alloc.opportunity.pool);
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
  for (const intent of intents) {
    const policyResult = await evaluateOpportunityPolicy({
      intent: {
        strategyId: "autopilot-portfolio",
        ...intent,
        amountUsd: intent.amountBtc * BTC_PRICE_USD,
        srcChain: intent.chain,
        dstChain: intent.chain,
        apr: intent.opportunity?.apy || 0,
        expectedHoldDays: 14,
        estimatedGasCostUsd: intent.estimatedGasUsd || 0.12,
        roundTripSuccessRate: 0.95,
        observedAt: now,
      },
      currentAllocations: {},
      capitalState: { totalDeployableCapital: capitalUsd },
    });

    if (policyResult.decision === "ALLOW") {
      gatedIntents.push({ ...intent, policy: "ALLOW" });
    } else {
      gatedIntents.push({ ...intent, policy: "BLOCK", blockers: policyResult.blockers });
    }
  }

  const approved = gatedIntents.filter((i) => i.policy === "ALLOW");
  const blocked = gatedIntents.filter((i) => i.policy === "BLOCK");

  // 9. Return tick result
  return {
    status: "completed",
    at: now,
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
      loop: { type: "boolean" },
    },
    allowPositionals: true,
  });

  const dryRun = values["dry-run"] !== false; // default dry-run
  const capitalBtc = values["capital-btc"] ? parseFloat(values["capital-btc"]) : null;
  const loop = values.loop || false;

  async function tick() {
    const result = await runAutopilotTick({ totalCapitalBtc: capitalBtc, dryRun });
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
