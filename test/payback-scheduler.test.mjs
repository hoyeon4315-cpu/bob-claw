import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";
import {
  buildCompositePaybackPlan,
  buildPaybackDecision,
  matchesCronExpression,
  runPaybackSchedulerTick,
} from "../src/executor/payback/scheduler.mjs";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";

const PAYBACK_POLICY_FIXTURE = {
  baseRatio: 0.2,
  minPaybackSats: 50_000,
  maxOfframpCostPctOfPayback: 0.1,
  perPeriodMaxSats: 500_000,
  annualMaxPaybackSats: 2_000_000,
  regimeMultipliers: {
    bear: 1.2,
    neutral: 1.0,
    bullPeak: 0.7,
  },
  volMultiplier: {
    cap: 1.0,
    thresholdAnnualized: 0.5,
  },
  emergencyPause: {
    offrampSlippageBpsMax: 200,
    operatingDrawdownPctMax: 30,
    protocolExploitList: [],
  },
  cronExpression: "0 0 * * 0",
  destinationPath: {
    profitReserveChain: "base",
    swapVenueOrdered: ["cowswap", "uniswap_v3"],
    composerRoute: "layerzero",
    gatewayOfframpStage: "BOB_L2",
    bitcoinDestAddressEnv: "PAYBACK_BTC_DEST_ADDR",
  },
};

function accumulatorFixture() {
  return {
    periodId: "week-2026-16",
    grossProfitSats_period: 400_000,
    paidBackSats_lifetime: 100_000,
    pendingDeferredSats: 300_000,
    operatingFloatSats_byChain: {
      base: 250_000,
    },
    kpi: {
      byr_rolling12m: 0.1,
      cg_rolling12m: 0.2,
      tbr_rolling12m: 0.3,
      roundTripEfficiency_period: 0.95,
      daysToBreakeven: 10,
    },
  };
}

function consolidationPlanFixture() {
  return {
    planStatus: "ready",
    blockedReason: null,
    quote: {
      outputAmount: {
        amount: "80000",
      },
      fees: {
        amount: "500",
      },
      executionFees: {
        amount: "250",
      },
    },
    intent: {
      strategyId: "gateway-btc-funding-transfer",
      chain: "base",
      family: "evm",
      intentType: "funding_transfer",
      amountUsd: 40,
      observedAt: "2026-04-17T00:00:00.000Z",
      quote: {
        observedAt: "2026-04-17T00:00:00.000Z",
      },
      tx: {
        to: WBTC_OFT_TOKEN,
        data: "0xc7c7f5b3",
        value: "0",
        gasLimit: "250000",
      },
      strategyConfig: {
        intentTtlMs: 60_000,
      },
      metadata: {
        skipAutoIngest: true,
      },
    },
  };
}

function offrampPlanFixture() {
  return {
    planStatus: "ready",
    blockedReason: null,
    quote: {
      outputAmount: {
        amount: "76000",
      },
      fees: {
        amount: "4000",
      },
    },
    intent: {
      strategyId: "gateway-btc-offramp",
      chain: "bob",
      family: "evm",
      intentType: "gateway_btc_offramp",
      amountUsd: 38,
      observedAt: "2026-04-17T00:00:00.000Z",
      quote: {
        observedAt: "2026-04-17T00:00:00.000Z",
      },
      tx: {
        to: WBTC_OFT_TOKEN,
        data: "0xc7c7f5b3",
        value: "0",
        gasLimit: "250000",
      },
      strategyConfig: {
        intentTtlMs: 60_000,
      },
      metadata: {
        skipAutoIngest: true,
      },
    },
  };
}

test("payback scheduler carries when planned payback is below minimum", async () => {
  process.env.PAYBACK_BTC_DEST_ADDR = "bc1qpayback0000000000000000000000000000000";

  const result = await buildPaybackDecision({
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    reserveState: {
      chain: "base",
      inputToken: WBTC_OFT_TOKEN,
      amount: "40000",
    },
    accumulatorSnapshot: () => ({
      ...accumulatorFixture(),
      grossProfitSats_period: 200_000,
    }),
  });

  assert.equal(result.status, "carry");
  assert.equal(result.reason, "planned_payback_below_minimum");
});

test("composite payback plan reuses existing helper intent formats and passes policy checks", async () => {
  process.env.PAYBACK_BTC_DEST_ADDR = "bc1qpayback0000000000000000000000000000000";

  const decision = await buildPaybackDecision({
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    reserveState: {
      chain: "base",
      inputToken: WBTC_OFT_TOKEN,
      amount: "80000",
    },
    accumulatorSnapshot: accumulatorFixture,
  });

  const result = await buildCompositePaybackPlan({
    decision,
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    signerHealthReader: async () => ({
      addresses: {
        base: "0x1111111111111111111111111111111111111111",
      },
    }),
    consolidationPlanBuilder: async () => consolidationPlanFixture(),
    offrampPlanBuilder: async () => offrampPlanFixture(),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.compositePlan.steps.length, 2);
  assert.equal(result.compositePlan.plannedPaybackSats, 75_250);

  for (const step of result.compositePlan.steps) {
    const intents = step.plan.steps?.map((item) => item.intent) || [step.plan.intent];
    for (const intent of intents) {
      const policy = await evaluateIntentPolicies({
        intent,
        auditRecords: [],
        now: "2026-04-17T00:00:00.000Z",
      });
      assert.equal(policy.decision, "ALLOW");
    }
  }
});

test("payback scheduler tick keeps audit-log-safe planning mode by default", async () => {
  process.env.PAYBACK_BTC_DEST_ADDR = "bc1qpayback0000000000000000000000000000000";

  const result = await runPaybackSchedulerTick({
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    execute: false,
    reserveState: {
      chain: "base",
      inputToken: WBTC_OFT_TOKEN,
      amount: "80000",
    },
    accumulatorSnapshot: accumulatorFixture,
    signerHealthReader: async () => ({
      addresses: {
        base: "0x1111111111111111111111111111111111111111",
      },
    }),
    consolidationPlanBuilder: async () => consolidationPlanFixture(),
    offrampPlanBuilder: async () => offrampPlanFixture(),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.execution, null);
  assert.equal(result.compositePlan.steps[0].kind, "gateway_btc_consolidation");
});

test("composite payback plan defers when offramp cost breaches the net-payback ratio guard", async () => {
  process.env.PAYBACK_BTC_DEST_ADDR = "bc1qpayback0000000000000000000000000000000";

  const decision = await buildPaybackDecision({
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    reserveState: {
      chain: "base",
      inputToken: WBTC_OFT_TOKEN,
      amount: "80000",
    },
    accumulatorSnapshot: () => ({
      ...accumulatorFixture(),
      grossProfitSats_period: 300_000,
    }),
  });

  const result = await buildCompositePaybackPlan({
    decision,
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    signerHealthReader: async () => ({
      addresses: {
        base: "0x1111111111111111111111111111111111111111",
      },
    }),
    consolidationPlanBuilder: async () => ({
      ...consolidationPlanFixture(),
      quote: {
        ...consolidationPlanFixture().quote,
        fees: {
          amount: "1000",
        },
        executionFees: {
          amount: "1000",
        },
      },
    }),
    offrampPlanBuilder: async () => ({
      ...offrampPlanFixture(),
      quote: {
        ...offrampPlanFixture().quote,
        fees: {
          amount: "3500",
        },
      },
    }),
  });

  assert.equal(result.status, "defer");
  assert.equal(result.reason, "estimated_offramp_cost_too_high");
});

test("cron matcher uses config-supplied weekly schedule", () => {
  assert.equal(matchesCronExpression("0 0 * * 0", "2026-04-19T00:00:00.000Z"), true);
  assert.equal(matchesCronExpression("0 0 * * 0", "2026-04-20T00:00:00.000Z"), false);
});
