import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { PAYBACK_CONFIG } from "../src/config/payback.mjs";
import snapshotPaybackAccumulator from "../src/executor/payback/accumulator.mjs";
import {
  buildCompositePaybackPlan,
  buildPaybackDecision,
  runPaybackSchedulerTick,
} from "../src/executor/payback/scheduler.mjs";

const NOW = "2026-05-09T00:00:00.000Z";
const OPERATOR = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
const PAYBACK_DESTINATION = "bc1qpayback0000000000000000000000000000000";

function realizedReceipt({ realizedPnlSats, observedAt = NOW } = {}) {
  return {
    schemaVersion: 1,
    timestamp: observedAt,
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    policyVerdict: "approved",
    lifecycle: {
      stage: "confirmed",
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    },
    realized: {
      realizedNetPnlSats: realizedPnlSats,
    },
  };
}

function reserveState(amount = "25000") {
  return {
    chain: "base",
    inputToken: WBTC_OFT_TOKEN,
    routeSideToken: WBTC_OFT_TOKEN,
    amount,
    senderAddress: OPERATOR,
  };
}

async function decisionFromReceipt(realizedPnlSats, overrides = {}) {
  return buildPaybackDecision({
    auditLogLines: [realizedReceipt({ realizedPnlSats })],
    reserveState: reserveState(),
    paybackConfig: PAYBACK_CONFIG,
    now: NOW,
    marketState: {
      operatingCapitalSats: 283_124,
      ...(overrides.marketState || {}),
    },
    riskState: overrides.riskState || {},
    getEnvImpl: (name) => (name === "PAYBACK_BTC_DEST_ADDR" ? PAYBACK_DESTINATION : null),
  });
}

function signerHealth() {
  return {
    status: "ok",
    addresses: {
      base: OPERATOR,
    },
  };
}

function consolidationPlan({ fees = "0", executionFees = "0", amount = "25000" } = {}) {
  return {
    planStatus: "ready",
    blockedReason: null,
    quote: {
      outputAmount: { amount },
      fees: { amount: fees },
      executionFees: { amount: executionFees },
    },
    intent: {
      strategyId: "gateway-btc-funding-transfer",
      chain: "base",
      family: "evm",
      intentType: "capital_rebalance",
      amountUsd: 1,
      tx: {
        to: WBTC_OFT_TOKEN,
        data: "0x",
        value: "0",
        gasLimit: "250000",
      },
      metadata: {
        skipAutoIngest: true,
      },
    },
  };
}

function offrampPlan({ fees = "0" } = {}) {
  return {
    planStatus: "ready",
    blockedReason: null,
    quote: {
      outputAmount: { amount: "25000" },
      fees: { amount: fees },
    },
    intent: {
      strategyId: "gateway-btc-offramp",
      chain: "bob",
      family: "evm",
      intentType: "gateway_btc_offramp",
      amountUsd: 1,
      tx: {
        to: WBTC_OFT_TOKEN,
        data: "0x",
        value: "0",
        gasLimit: "250000",
      },
      metadata: {
        skipAutoIngest: true,
      },
    },
  };
}

test("realized receipt carries while accumulator target is below the effective minimum", async () => {
  const decision = await decisionFromReceipt(24_000);

  assert.equal(decision.snapshot.grossProfitSats_period, 24_000);
  assert.equal(decision.snapshot.pendingDeferredSats, 24_000);
  assert.equal(decision.policy.minPaybackSats, 5_000);
  assert.equal(decision.status, "carry");
  assert.equal(decision.reason, "planned_payback_below_minimum");
  assert.equal(decision.decisionLog.inputs.grossTargetBeforeCostsSats, 4_800);
});

test("realized receipt creates the first delivery candidate exactly at the effective minimum", async () => {
  const decision = await decisionFromReceipt(25_000);
  const plan = await buildCompositePaybackPlan({
    decision,
    paybackConfig: PAYBACK_CONFIG,
    signerHealthReader: signerHealth,
    consolidationPlanBuilder: async () => consolidationPlan(),
    offrampPlanBuilder: async () => offrampPlan(),
    now: NOW,
  });

  assert.equal(decision.status, "plan");
  assert.equal(decision.decisionLog.applied.grossTargetBeforeCostsSats, 5_000);
  assert.equal(plan.status, "ready");
  assert.equal(plan.reason, "emit_intents");
  assert.equal(plan.compositePlan.plannedPaybackSats, 5_000);
  assert.equal(plan.compositePlan.estimatedOfframpCostSats, 0);
});

test("realized receipt defers when estimated offramp cost breaches policy ratio", async () => {
  const decision = await decisionFromReceipt(250_000);
  const plan = await buildCompositePaybackPlan({
    decision,
    paybackConfig: PAYBACK_CONFIG,
    signerHealthReader: signerHealth,
    consolidationPlanBuilder: async () => consolidationPlan({ fees: "4000" }),
    offrampPlanBuilder: async () => offrampPlan({ fees: "2000" }),
    now: NOW,
  });

  assert.equal(decision.status, "plan");
  assert.equal(plan.status, "defer");
  assert.equal(plan.reason, "estimated_offramp_cost_too_high");
  assert.equal(plan.decision.decisionLog.result.estimatedOfframpCostSats, 6_000);
});

test("emergency pause and kill-switch prevent a planned payback candidate", async () => {
  const paused = await decisionFromReceipt(250_000, {
    riskState: {
      operatingDrawdownPct: 31,
    },
  });

  assert.equal(paused.status, "paused");
  assert.equal(paused.reason, "operating_drawdown_limit_exceeded");

  process.env.PAYBACK_BTC_DEST_ADDR = PAYBACK_DESTINATION;
  const halted = await runPaybackSchedulerTick({
    auditLogLines: [realizedReceipt({ realizedPnlSats: 250_000 })],
    reserveState: reserveState(),
    paybackConfig: PAYBACK_CONFIG,
    marketState: {
      operatingCapitalSats: 283_124,
    },
    now: NOW,
    killSwitchChecker: async () => ({
      decision: "BLOCK",
      blockers: ["kill_switch_present"],
    }),
    signerHealthReader: signerHealth,
    consolidationPlanBuilder: async () => consolidationPlan(),
    offrampPlanBuilder: async () => offrampPlan(),
  });

  assert.equal(halted.status, "halted");
  assert.equal(halted.reason, "kill_switch_present");
  assert.equal(halted.compositePlan, null);
});

test("accumulator reads one confirmed receipt without changing payback formulas", () => {
  const snapshot = snapshotPaybackAccumulator(
    [realizedReceipt({ realizedPnlSats: 25_000 })],
    {},
    {
      periodId: "test-period",
      periodStartAt: "2026-05-08T00:00:00.000Z",
      periodEndAt: "2026-05-10T00:00:00.000Z",
    },
  );

  assert.equal(snapshot.periodId, "test-period");
  assert.equal(snapshot.grossProfitSats_period, 25_000);
  assert.equal(snapshot.pendingDeferredSats, 25_000);
  assert.equal(snapshot.paidBackSats_lifetime, 0);
});
