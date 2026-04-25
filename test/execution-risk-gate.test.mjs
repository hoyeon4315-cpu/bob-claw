import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExecutionRiskDecision, buildExecutionRiskState } from "../src/risk/execution-gate.mjs";
import { buildDefaultRiskPolicy } from "../src/risk/policy.mjs";

function inventoryFixture(walletUsd = 280) {
  return {
    summary: {
      estimatedWalletUsd: walletUsd,
    },
  };
}

function jobFixture(overrides = {}) {
  return {
    jobId: "job-1",
    createdAt: "2026-04-11T06:00:00.000Z",
    requiresManualReview: false,
    fundingSource: {
      selectionStatus: "ready",
      requiresReserveState: false,
      requiresManualFunding: false,
      missingInputs: [],
    },
    systemEconomics: {
      tradeReadiness: "shadow_candidate_review_only",
      routeInputUsd: 10,
      routeNetEdgeUsd: 0.8,
      routeExecutableNetEdgeUsd: 0.8,
      effectiveSystemNetPnlUsd: 0.6,
    },
    ...overrides,
  };
}

test("risk state summarizes realized pnl, failed gas, and consecutive failures", () => {
  const riskState = buildExecutionRiskState({
    now: "2026-04-11T07:00:00.000Z",
    inventory: inventoryFixture(),
    receiptRecords: [
      {
        observedAt: "2026-04-11T06:30:00.000Z",
        reconciliationStatus: "failed",
        realized: { realizedNetPnlUsd: -0.4, actualKnownCostUsd: 0.4 },
      },
      {
        observedAt: "2026-04-11T06:45:00.000Z",
        reconciliationStatus: "reconciled",
        realized: { realizedNetPnlUsd: 0.2, actualKnownCostUsd: 0.1 },
      },
    ],
    executionEvents: [
      { observedAt: "2026-04-11T06:40:00.000Z", status: "failed" },
      { observedAt: "2026-04-11T06:50:00.000Z", status: "failed" },
    ],
  });

  assert.equal(riskState.dailyRealizedPnlUsd, -0.2);
  assert.equal(riskState.failedGasCost24hUsd, 0.4);
  assert.equal(riskState.consecutiveFailures, 2);
  assert.equal(riskState.walletEstimatedUsd, 280);
});

test("risk state treats delivered executions as terminal successes that reset failure streaks", () => {
  const riskState = buildExecutionRiskState({
    now: "2026-04-11T07:00:00.000Z",
    inventory: inventoryFixture(),
    receiptRecords: [],
    executionEvents: [
      { observedAt: "2026-04-11T06:40:00.000Z", status: "failed" },
      { observedAt: "2026-04-11T06:50:00.000Z", status: "delivered" },
      { observedAt: "2026-04-11T06:55:00.000Z", status: "failed" },
    ],
  });

  assert.equal(riskState.consecutiveFailures, 1);
});

test("risk gate allows a healthy refill job", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture(),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "dry_run",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "ALLOW");
  assert.equal(decision.blockers.length, 0);
  assert.equal(decision.reviews.length, 0);
});

test("risk gate blocks jobs when economics or limits fail", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      systemEconomics: {
        tradeReadiness: "reject_no_net_edge",
        routeInputUsd: 10,
        routeNetEdgeUsd: -0.8,
        routeExecutableNetEdgeUsd: -0.8,
        effectiveSystemNetPnlUsd: -1.1,
      },
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(200),
      receiptRecords: [
        {
          observedAt: "2026-04-11T06:05:00.000Z",
          reconciliationStatus: "failed",
          realized: { realizedNetPnlUsd: -6, actualKnownCostUsd: 3.5 },
        },
      ],
      executionEvents: [
        { observedAt: "2026-04-11T06:03:00.000Z", status: "failed" },
        { observedAt: "2026-04-11T06:04:00.000Z", status: "failed" },
        { observedAt: "2026-04-11T06:05:00.000Z", status: "failed" },
      ],
    }),
    // Override the default policy with explicit caps so this test still
    // exercises the "gate enforces limits when configured" path. The project
    // default no longer sets these caps.
    riskPolicy: {
      ...buildDefaultRiskPolicy(),
      projectLossCapUsd: 300,
      dailyLossCapUsd: 5,
      canaryWalletFloorUsd: 250,
      maxConsecutiveFailures: 3,
    },
    mode: "live",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "BLOCKED");
  assert.equal(decision.blockers.includes("wallet_floor_breached"), true);
  assert.equal(decision.blockers.includes("daily_loss_cap_reached"), true);
  assert.equal(decision.blockers.includes("failed_gas_cap_reached"), true);
  assert.equal(decision.blockers.includes("max_consecutive_failures_reached"), true);
  assert.equal(decision.blockers.includes("route_trade_rejected"), true);
  assert.equal(decision.blockers.includes("system_net_pnl_non_positive"), true);
});

test("risk gate allows native refill jobs to pass with negative system pnl when no other blockers apply", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      type: "refill_native",
      systemEconomics: {
        tradeReadiness: "insufficient_data",
        routeInputUsd: 10,
        routeNetEdgeUsd: -0.8,
        routeExecutableNetEdgeUsd: null,
        effectiveSystemNetPnlUsd: -1.1,
      },
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "dry_run",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "ALLOW");
  assert.equal(decision.blockers.includes("system_net_pnl_non_positive"), false);
});

test("risk gate treats token refill as operating inventory, not instant alpha", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      type: "refill_token",
      systemEconomics: {
        tradeReadiness: "reject_no_net_edge",
        routeInputUsd: 0.25,
        routeNetEdgeUsd: -0.08,
        routeExecutableNetEdgeUsd: -0.08,
        effectiveSystemNetPnlUsd: -0.3,
      },
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "live",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "ALLOW");
  assert.equal(decision.blockers.includes("route_trade_rejected"), false);
  assert.equal(decision.blockers.includes("system_net_pnl_non_positive"), false);
});

test("risk gate does not apply instant system PnL blocker to holding-period yield jobs", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      strategyPolicy: {
        id: "recursive_wrapped_btc_lending_loop",
        category: "yield",
        economicsMode: "holding_period_carry",
        strategyType: "leverage_lending_loop",
        isLeverage: true,
        perTradeCapUsd: 300,
        healthFactorMin: 1.35,
        liquidationBufferPct: 12,
        unwindTriggerHealthFactor: 1.3,
        maxLoopIterations: 4,
        maxLtvPct: 62,
        currentHealthFactor: 1.65,
        currentLiquidationBufferPct: 20,
      },
      systemEconomics: {
        tradeReadiness: "strategy_candidate_review_only",
        routeInputUsd: 300,
        routeNetEdgeUsd: null,
        routeExecutableNetEdgeUsd: null,
        effectiveSystemNetPnlUsd: -2.4,
      },
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(500),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "live",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "ALLOW");
  assert.equal(decision.blockers.includes("system_net_pnl_non_positive"), false);
  assert.equal(decision.metrics.holdingPeriodCarryStrategy, true);
});

test("risk gate returns review for conditional/manual funding without hard blockers", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      fundingSource: {
        selectionStatus: "conditional",
        requiresReserveState: true,
        requiresManualFunding: true,
        missingInputs: ["bootstrap_native_required"],
      },
      requiresManualReview: true,
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "dry_run",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "REVIEW");
  assert.equal(decision.reviews.includes("job_requires_manual_review"), true);
  assert.equal(decision.reviews.includes("conditional_funding_source"), true);
  assert.equal(decision.reviews.includes("reserve_state_unmodelled"), true);
  assert.equal(decision.reviews.includes("manual_funding_dependency"), true);
  assert.equal(decision.reviews.includes("bootstrap_native_required"), true);
});

test("risk gate allows auto-executable conditional funding sources with settlement proof requirements", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      fundingSource: {
        selectionStatus: "conditional",
        requiresReserveState: false,
        requiresManualFunding: false,
        missingInputs: [],
        settlementRequirements: ["gas_zip_destination_native_delta_proof_required"],
      },
      requiresManualReview: false,
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "dry_run",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "ALLOW");
  assert.equal(decision.reviews.includes("conditional_funding_source"), false);
});

test("live risk gate blocks strategy jobs without a declared per-trade cap", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      strategyId: "wrapped-btc-loop",
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "live",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "BLOCKED");
  assert.equal(decision.blockers.includes("strategy_policy_missing"), true);
  assert.equal(decision.blockers.includes("strategy_per_trade_cap_missing"), true);
});

test("live risk gate blocks when strategy per-trade cap is exceeded", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      strategyPolicy: {
        id: "wrapped-btc-loop",
        perTradeCapUsd: 5,
      },
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "live",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "BLOCKED");
  assert.equal(decision.blockers.includes("strategy_per_trade_cap_exceeded"), true);
});

test("live risk gate caps refill jobs against target exposure, not only sampled route size", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      estimatedAssetValueUsd: 74,
      strategyPolicy: {
        id: "merkl_portfolio_stable_carry_refill",
        category: "yield",
        economicsMode: "holding_period_carry",
        perTradeCapUsd: 25,
      },
      systemEconomics: {
        tradeReadiness: "insufficient_data",
        routeInputUsd: 4,
        routeNetEdgeUsd: -0.8,
        routeExecutableNetEdgeUsd: null,
        effectiveSystemNetPnlUsd: -1.1,
      },
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "live",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "BLOCKED");
  assert.equal(decision.blockers.includes("strategy_per_trade_cap_exceeded"), true);
  assert.equal(decision.blockers.includes("system_net_pnl_non_positive"), false);
  assert.equal(decision.metrics.exposureUsd, 74);
  assert.equal(decision.metrics.holdingPeriodCarryStrategy, true);
});

test("live risk gate ignores sampled route input when refill target exposure is lower", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      type: "refill_token",
      estimatedAssetValueUsd: 68,
      strategyPolicy: {
        id: "merkl_portfolio_stable_carry_refill",
        category: "yield",
        economicsMode: "holding_period_carry",
        perTradeCapUsd: 75,
      },
      systemEconomics: {
        tradeReadiness: "insufficient_data",
        routeInputUsd: 250,
        routeNetEdgeUsd: -0.8,
        routeExecutableNetEdgeUsd: null,
        effectiveSystemNetPnlUsd: -1.1,
      },
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "live",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "ALLOW");
  assert.equal(decision.blockers.includes("strategy_per_trade_cap_exceeded"), false);
  assert.equal(decision.metrics.exposureUsd, 68);
});

test("live risk gate blocks leverage jobs with missing unwind and health controls", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      strategyPolicy: {
        id: "wrapped-btc-loop",
        isLeverage: true,
        perTradeCapUsd: 25,
      },
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "live",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "BLOCKED");
  assert.equal(decision.blockers.includes("leverage_policy_fields_missing"), true);
  assert.deepEqual(decision.metrics.missingLeverageFields, [
    "healthFactorMin",
    "liquidationBufferPct",
    "unwindTriggerHealthFactor",
    "maxLoopIterations",
    "maxLtvPct",
  ]);
});

test("live risk gate blocks leverage jobs when current health buffers are already breached", () => {
  const decision = buildExecutionRiskDecision({
    job: jobFixture({
      strategyPolicy: {
        id: "wrapped-btc-loop",
        isLeverage: true,
        perTradeCapUsd: 25,
        healthFactorMin: 1.35,
        liquidationBufferPct: 12,
        unwindTriggerHealthFactor: 1.3,
        maxLoopIterations: 4,
        maxLtvPct: 62,
        currentHealthFactor: 1.29,
        currentLiquidationBufferPct: 9,
      },
    }),
    riskState: buildExecutionRiskState({
      now: "2026-04-11T06:10:00.000Z",
      inventory: inventoryFixture(280),
      receiptRecords: [],
      executionEvents: [],
    }),
    riskPolicy: buildDefaultRiskPolicy(),
    mode: "live",
    now: "2026-04-11T06:10:00.000Z",
  });

  assert.equal(decision.decision, "BLOCKED");
  assert.equal(decision.blockers.includes("health_factor_below_min"), true);
  assert.equal(decision.blockers.includes("liquidation_buffer_below_min"), true);
});
