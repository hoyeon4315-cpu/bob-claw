import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProtocolMarketWatchers, summarizeProtocolMarketWatchers } from "../src/strategy/protocol-market-watchers.mjs";
import { buildAllocatorCore } from "../src/strategy/allocator-core.mjs";

test("protocol market watchers surface freshness and trust-tier blockers to the allocator", () => {
  const watchers = buildProtocolMarketWatchers({
    dashboardStatus: {
      overall: { blockers: ["stale_gas_snapshots"] },
    },
    quoteLagLatest: {
      generatedAt: "2026-04-15T01:00:00.000Z",
      sampleCount: 500,
      lagStats: { profitableSampleCount: 1, profitableSamplePct: 0.2 },
      verdict: "profitable_dislocations_found",
    },
    dexSpreadLatest: {
      observedAt: "2026-04-15T01:00:00.000Z",
      chainCount: 7,
      tokenCount: 11,
    },
    wrappedBtcLendingLoopSlice: {
      strategy: { id: "wrapped-btc-loop-base-moonwell", protocol: "moonwell" },
      protocolAdapter: {
        oracleModel: "protocol_oracle_with_btc_usd_sanity_check",
        referenceOracles: ["chainlink", "pyth"],
      },
      oracleSanity: { status: "healthy", protocolDriftPct: 0.12 },
      dryRunSummary: { autoUnwindPassCount: 2, dryRunReceiptRecorded: true },
    },
    phase3Validation: {
      validations: [
        {
          id: "wrapped_btc_loop_validation",
          overallStatus: "blocked",
          blockers: ["oos_receipt_window_below_policy", "protocol_trust_tier_not_recorded"],
          evidence: { strategyId: "wrapped-btc-loop-base-moonwell" },
          nextAction: { code: "collect_wrapped_btc_loop_oos_receipts" },
        },
        {
          id: "stablecoin_spread_loop_validation",
          overallStatus: "blocked",
          blockers: ["overfit_gate_blocked", "protocol_trust_tier_not_recorded"],
          evidence: { strategyId: "stablecoin_spread_loop", statusNew: "measured_overfit_blocked", netPnlMeasuredUsd: 1.2 },
        },
        {
          id: "proxy_spread_expansion_validation",
          overallStatus: "blocked",
          blockers: ["overfit_gate_blocked", "receipt_backed_cross_wrapper_samples_missing"],
          trustTierStatus: "market_structure_review_required",
          evidence: { strategyId: "proxy_spread_expansion" },
        },
      ],
    },
    secondaryStrategyScaffolds: {
      scaffolds: [
        {
          id: "stablecoin_spread_loop",
          missingEvidence: ["borrow_spread_decay_samples"],
          protocolTrack: { protocols: ["morpho", "aave_v3"] },
        },
      ],
    },
    now: "2026-04-15T13:00:00.000Z",
  });

  assert.equal(watchers.summary.watcherCount, 5);
  assert.equal(watchers.summary.blockedCount >= 4, true);

  const summary = summarizeProtocolMarketWatchers(watchers);
  assert.equal(summary.topBlocked.id, "wrapped_btc_loop_market_watch");
  assert.deepEqual(watchers.watchers[0].evidence.referenceOracles, ["chainlink", "pyth"]);
  assert.equal(watchers.watchers[0].evidence.oracleStatus, "healthy");
  const trustTierWatch = watchers.watchers.find((item) => item.id === "protocol_trust_tier_watch");
  assert.deepEqual(trustTierWatch.targets.sort(), ["stablecoin_spread_loop", "wrapped-btc-loop-base-moonwell"]);

  const allocator = buildAllocatorCore({
    strategySnapshot: { currentSystem: { activeBudgetUsd: 300 }, summary: { planningBudgetUsd: 1000 } },
    phase3Validation: {
      validations: [
        {
          id: "wrapped_btc_loop_validation",
          overallStatus: "blocked",
          blockers: ["oos_receipt_window_below_policy"],
          nextAction: { code: "collect_wrapped_btc_loop_oos_receipts" },
        },
      ],
    },
    wrappedBtcLendingLoopSlice: {
      strategy: {
        id: "wrapped-btc-loop-base-moonwell",
        label: "Wrapped BTC lending loop (Base / Moonwell)",
        chain: "base",
        protocol: "moonwell",
      },
    },
    protocolMarketWatchers: watchers,
    now: "2026-04-15T13:00:00.000Z",
  });
  const wrapped = allocator.candidates.find((item) => item.id === "wrapped-btc-loop-base-moonwell");
  assert.ok(wrapped);
  assert.equal(wrapped.blockers.includes("protocol_trust_tier_not_recorded"), true);
  assert.equal(wrapped.blockers.includes("stale_gas_snapshots"), true);
});
