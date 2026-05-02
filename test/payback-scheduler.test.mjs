import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";
import {
  buildCompositePaybackPlan,
  buildPaybackDecision,
  buildPaybackDisbursementRecord,
  matchesCronExpression,
  runPaybackSchedulerTick,
  submitCompositePaybackPlan,
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

test("payback scheduler carries below minimum even when reserve inventory is missing", async () => {
  process.env.PAYBACK_BTC_DEST_ADDR = "bc1qpayback0000000000000000000000000000000";

  const result = await buildPaybackDecision({
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    reserveState: null,
    receiptStore: {
      treasuryInventory: [],
      inventorySnapshots: [],
    },
    accumulatorSnapshot: () => ({
      ...accumulatorFixture(),
      grossProfitSats_period: 200_000,
    }),
  });

  assert.equal(result.status, "carry");
  assert.equal(result.reason, "planned_payback_below_minimum");
});

test("payback decision reports missing destination config before carry", async () => {
  delete process.env.PAYBACK_BTC_DEST_ADDR;

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
    getEnvImpl: () => null,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "missing_destination_config");
  assert.equal(result.decisionLog.inputs.underlyingReason, "payback_btc_destination_missing");
});

test("composite payback plan reuses decision recipient for preview", async () => {
  const decision = await buildPaybackDecision({
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    reserveState: {
      chain: "base",
      inputToken: WBTC_OFT_TOKEN,
      amount: "80000",
    },
    accumulatorSnapshot: accumulatorFixture,
    recipientOverride: "bc1qoverride",
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
  assert.equal(result.compositePlan.recipient, "bc1qoverride");
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

test("payback scheduler tick halts before planning when kill-switch is active", async () => {
  process.env.PAYBACK_BTC_DEST_ADDR = "bc1qpayback0000000000000000000000000000000";
  let planBuilderCalled = false;

  const result = await runPaybackSchedulerTick({
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    execute: true,
    reserveState: {
      chain: "base",
      inputToken: WBTC_OFT_TOKEN,
      amount: "80000",
    },
    accumulatorSnapshot: accumulatorFixture,
    consolidationPlanBuilder: async () => {
      planBuilderCalled = true;
      return consolidationPlanFixture();
    },
    killSwitchPath: "/tmp/bob-claw-test-kill-switch",
    killSwitchChecker: async ({ killSwitchPath, now }) => ({
      policy: "kill_switch",
      observedAt: now,
      decision: "BLOCK",
      blockers: ["kill_switch_present"],
      killSwitchPath,
    }),
  });

  assert.equal(result.status, "halted");
  assert.equal(result.reason, "kill_switch_present");
  assert.equal(result.compositePlan, null);
  assert.equal(result.execution, null);
  assert.equal(planBuilderCalled, false);
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

test("payback disbursement record contains every AGENTS.md required audit field", async () => {
  process.env.PAYBACK_BTC_DEST_ADDR = "bc1qpayback0000000000000000000000000000000";

  const decision = await buildPaybackDecision({
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    reserveState: {
      chain: "base",
      inputToken: WBTC_OFT_TOKEN,
      amount: "80000",
    },
    accumulatorSnapshot: accumulatorFixture,
    marketState: {
      periodId: "week-2026-16",
      periodStartAt: "2026-04-13T00:00:00.000Z",
      periodEndAt: "2026-04-20T00:00:00.000Z",
    },
  });

  const planning = await buildCompositePaybackPlan({
    decision,
    paybackConfig: PAYBACK_POLICY_FIXTURE,
    signerHealthReader: async () => ({
      addresses: { base: "0x1111111111111111111111111111111111111111" },
    }),
    consolidationPlanBuilder: async () => consolidationPlanFixture(),
    offrampPlanBuilder: async () => offrampPlanFixture(),
  });

  const result = await submitCompositePaybackPlan({
    compositePlan: planning.compositePlan,
    tokenDexExecutor: async () => ({ realized: { realizedNetCostSats: 100 } }),
    consolidationExecutor: async () => ({ realized: { realizedNetCostSats: 900 } }),
    offrampExecutor: async () => ({
      settlementStatus: "delivered",
      plan: {
        order: { orderId: "gateway-order-xyz" },
        intent: { metadata: { gatewayOrderId: "gateway-order-xyz" } },
      },
      signerResult: { broadcast: { txHash: "0xsourcetx" } },
      realized: { realizedNetCostSats: 4000 },
      destinationProof: {
        status: "delivered",
        observedDelta: "70000",
        txid: "btc-txid-xyz",
      },
    }),
    now: "2026-04-20T00:00:00.000Z",
  });

  assert.equal(result.status, "submitted");
  const record = result.disbursementRecord;
  assert.ok(record, "disbursement record emitted");
  assert.equal(record.kind, "payback_disbursement");
  assert.equal(record.strategyId, "gateway-btc-offramp");
  assert.equal(record.periodId, "week-2026-16");
  assert.equal(record.chain, "base");
  assert.equal(record.harvestWindow.startAt, "2026-04-13T00:00:00.000Z");
  assert.equal(record.harvestWindow.endAt, "2026-04-20T00:00:00.000Z");
  assert.equal(record.grossProfitSats, 400_000);
  assert.equal(record.grossTargetBeforeCostsSats, 80_000);
  assert.equal(record.appliedRatios.baseRatio, 0.2);
  assert.equal(record.appliedRatios.regime, "neutral");
  assert.equal(record.appliedRatios.regimeMultiplier, 1);
  assert.equal(record.appliedRatios.volMultiplier, 1);
  assert.equal(record.plannedPaybackSats, 75_250);
  assert.equal(record.estimatedRoundTripCostSats, 4_750);
  assert.equal(record.realizedRoundTripCostSats, 4_900);
  assert.equal(record.gatewayOrderId, "gateway-order-xyz");
  assert.equal(record.bitcoinTxid, "btc-txid-xyz");
  assert.equal(record.sourceTxHash, "0xsourcetx");
  assert.equal(record.settlementStatus, "delivered");
  assert.equal(record.settledBalanceDeltaSats, 70_000);
});

test("payback disbursement helper accepts minimal offramp-only composite plan", () => {
  const record = buildPaybackDisbursementRecord({
    compositePlan: {
      plannedPaybackSats: 60_000,
      estimatedOfframpCostSats: 3_000,
      recipient: "bc1qrecipient",
      senderAddress: "0xsender",
      route: { reserveChain: "base" },
      decisionLog: {
        inputs: {
          grossProfitSatsPeriod: 400_000,
          periodStartAt: "2026-04-13T00:00:00.000Z",
          periodEndAt: "2026-04-20T00:00:00.000Z",
        },
        applied: {
          baseRatio: 0.2,
          regime: "neutral",
          regimeMultiplier: 1,
          volMultiplier: 1,
          grossTargetBeforeCostsSats: 80_000,
        },
      },
    },
    stepResults: [
      {
        kind: "gateway_btc_offramp",
        execution: {
          settlementStatus: "delivered",
          plan: { order: { orderId: "order-abc" } },
          signerResult: { broadcast: { txHash: "0xhash" } },
          realized: { realizedNetCostSats: 3_200 },
          destinationProof: {
            status: "delivered",
            observedDelta: "56800",
            txid: "btc-abc",
          },
        },
      },
    ],
    now: "2026-04-20T00:00:00.000Z",
  });
  assert.equal(record.gatewayOrderId, "order-abc");
  assert.equal(record.bitcoinTxid, "btc-abc");
  assert.equal(record.settledBalanceDeltaSats, 56_800);
  assert.equal(record.realizedRoundTripCostSats, 3_200);
  assert.equal(record.plannedPaybackSats, 60_000);
});

test("payback submission forwards signer and settlement options to every executable step", async () => {
  const calls = [];
  await submitCompositePaybackPlan({
    compositePlan: {
      plannedPaybackSats: 60_000,
      estimatedOfframpCostSats: 3_000,
      recipient: "bc1qrecipient",
      senderAddress: "0xsender",
      route: { reserveChain: "base" },
      decisionLog: { inputs: {}, applied: {} },
      steps: [
        { id: "swap", kind: "token_dex_swap", plan: { marker: "swap" } },
        { id: "bridge", kind: "gateway_btc_consolidation", plan: { marker: "bridge" } },
        { id: "offramp", kind: "gateway_btc_offramp", plan: { marker: "offramp" } },
      ],
    },
    executionOptions: {
      socketPath: "/tmp/payback.sock",
      timeoutMs: 45_000,
      awaitConfirmation: false,
      awaitDestinationSettlement: false,
      confirmations: 2,
      confirmationTimeoutMs: 180_000,
      destinationSettlementTimeoutMs: 240_000,
      destinationPollIntervalMs: 3_000,
    },
    tokenDexExecutor: async (input) => {
      calls.push({ kind: "swap", input });
      return { settlementStatus: "delivered" };
    },
    consolidationExecutor: async (input) => {
      calls.push({ kind: "bridge", input });
      return { settlementStatus: "delivered" };
    },
    offrampExecutor: async (input) => {
      calls.push({ kind: "offramp", input });
      return {
        settlementStatus: "source_confirmed_only",
        destinationProof: null,
      };
    },
    disbursementRecordBuilder: null,
  });

  assert.deepEqual(calls.map((item) => item.kind), ["swap", "bridge", "offramp"]);
  for (const call of calls) {
    assert.equal(call.input.socketPath, "/tmp/payback.sock");
    assert.equal(call.input.timeoutMs, 45_000);
    assert.equal(call.input.awaitConfirmation, false);
    assert.equal(call.input.confirmations, 2);
    assert.equal(call.input.confirmationTimeoutMs, 180_000);
  }
  assert.equal(calls[0].input.awaitDestinationSettlement, false);
  assert.equal(calls[1].input.awaitDestinationSettlement, false);
  assert.equal(calls[2].input.awaitBitcoinSettlement, false);
  assert.equal(calls[2].input.bitcoinSettlementTimeoutMs, 240_000);
  assert.equal(calls[2].input.bitcoinPollIntervalMs, 3_000);
});
