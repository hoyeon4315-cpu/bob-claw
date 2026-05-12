import assert from "node:assert/strict";
import { test } from "node:test";

import { runAllChainAutopilot } from "../src/executor/all-chain-autopilot.mjs";

const emptyReceiptJsonl = async () => [];

function walletWithIdleDust() {
  return {
    address: "0x1111111111111111111111111111111111111111",
    totalUsd: 357,
    items: [
      { sym: "yo", name: "yoUSD", chain: "base", amount: 70, usd: 70, family: "protocol", protocolId: "yo" },
      { sym: "RLUSD", name: "RLUSD", chain: "ethereum", amount: 25, usd: 25, family: "token" },
      { sym: "cbBTC", name: "cbBTC", chain: "base", amount: 0.0002, usd: 20, family: "token" },
      { sym: "ETH", name: "ETH", chain: "ethereum", amount: 0.01, usd: 20, family: "native" },
      ...["bsc", "avalanche", "unichain", "sonic", "sei", "bera", "soneium", "bob"].map((chain) => ({
        sym: "wbtc",
        name: "wBTC.OFT",
        chain,
        amount: 0.0001,
        usd: 7,
        family: "token",
        firstSeenAt: "2026-05-01T00:00:00.000Z",
      })),
    ],
  };
}

function walletWithNestedAddressOnly() {
  const wallet = walletWithIdleDust();
  const { address, ...rest } = wallet;
  void address;
  return {
    ...rest,
    summary: {
      walletAddress: "0x2222222222222222222222222222222222222222",
    },
  };
}

function walletWithoutTrustedOwnerAddress() {
  const wallet = walletWithIdleDust();
  const { address, ...rest } = wallet;
  void address;
  return {
    ...rest,
    items: wallet.items.map((item) => ({
      ...item,
      address: "0x000000000000000000000000000000000000dEaD",
      account: "0x3333333333333333333333333333333333333333",
    })),
  };
}

function okJson(json = {}) {
  return { ok: true, exitCode: 0, stdout: "", stderr: "", json };
}

function fakeCommand({ events, autoKill = {} } = {}) {
  return async ({ args }) => {
    const name = args[0];
    events.push(`cmd:${name}`);
    if (name.endsWith("run-auto-kill-check.mjs")) {
      return okJson({
        triggered: false,
        killSwitchActive: false,
        alreadyArmed: false,
        ...autoKill,
      });
    }
    if (name.endsWith("plan-treasury-refill-jobs.mjs")) {
      return okJson({ summary: { jobCount: 0 }, jobs: [] });
    }
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return okJson({
        rebalancePlan: { decision: "NOOP", actions: [] },
        capitalPlan: { decision: "NOOP", summary: { actionCount: 0, blockerCount: 0 } },
        jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
      });
    }
    if (name.endsWith("run-inbound-inventory-watcher.mjs")) {
      return okJson({
        summary: {
          inboundEventCount: 0,
          operatingCapitalIngressCount: 0,
          paybackExcludedCount: 0,
          routeReadyCount: 0,
        },
        routingPlan: { jobs: [] },
      });
    }
    return okJson({});
  };
}

test("all-chain autopilot queues idle BTC-family dust through gateway consolidation before refill", async () => {
  const events = [];
  const builtPlans = [];
  const queuedPlans = [];
  const auditRecords = [];

  const report = await runAllChainAutopilot({
    execute: true,
    stopAfterRefill: true,
    observedAt: "2026-05-08T05:00:00.000Z",
    runCommandImpl: fakeCommand({ events }),
    readJsonlImpl: emptyReceiptJsonl,
    readWalletSnapshotImpl: async () => walletWithIdleDust(),
    buildGatewayBtcConsolidationPlanImpl: async (args) => {
      events.push(`idle_builder:${args.srcChain}`);
      builtPlans.push(args);
      return {
        schemaVersion: 1,
        observedAt: args.now,
        planStatus: "ready",
        strategyId: "gateway-btc-funding-transfer",
        route: { srcChain: args.srcChain, dstChain: args.dstChain },
        amount: args.amount,
        amountUsd: 7,
        intent: {
          strategyId: "gateway-btc-funding-transfer",
          chain: args.srcChain,
          intentId: `idle:${args.srcChain}`,
          intentType: "gateway_btc_transfer",
          amountUsd: 7,
          mode: "live",
          metadata: {},
        },
      };
    },
    executeGatewayBtcConsolidationPlanImpl: async ({ plan }) => {
      queuedPlans.push(plan);
      return { signerResult: { status: "queued" } };
    },
    appendSignerAuditRecordImpl: async (record) => {
      auditRecords.push(record);
      return "/tmp/signer-audit.jsonl";
    },
  });

  assert.equal(report.phase, "refill_complete");
  assert.equal(report.idleConsolidationPlan.status, "plan_ready");
  assert.equal(report.idleConsolidationPlan.aggregateUsd, 50);
  assert.ok(report.idleConsolidationPlan.candidates.every((item) => item.srcSym === "wBTC.OFT"));
  assert.equal(
    report.idleConsolidationPlan.candidates.some((item) =>
      /yo|rlusd|cbbtc|eth|native/i.test(`${item.srcSym}:${item.srcChain}`),
    ),
    false,
  );
  assert.equal(builtPlans.length, report.idleConsolidationPlan.candidates.length);
  assert.equal(queuedPlans.length, report.idleConsolidationPlan.candidates.length);
  assert.equal(report.summary.idleConsolidation.queuedIntentCount, report.idleConsolidationPlan.candidates.length);
  assert.equal(
    auditRecords.every((record) => record.lifecycle?.stage === "idle_consolidation_planned"),
    true,
  );
  assert.equal(
    queuedPlans.every(
      (plan) => plan.intent?.metadata?.idleInventoryConsolidation?.stage === "idle_consolidation_planned",
    ),
    true,
  );

  const autoKillIndex = events.findIndex((event) => event === "cmd:src/cli/run-auto-kill-check.mjs");
  const firstIdleBuilderIndex = events.findIndex((event) => event.startsWith("idle_builder:"));
  const refillIndex = events.findIndex((event) => event === "cmd:src/cli/plan-treasury-refill-jobs.mjs");
  assert.ok(autoKillIndex >= 0 && firstIdleBuilderIndex > autoKillIndex);
  assert.ok(refillIndex > firstIdleBuilderIndex);
});

test("all-chain autopilot does not emit idle consolidation plan while kill-switch is active", async () => {
  const events = [];
  let buildCount = 0;

  const report = await runAllChainAutopilot({
    execute: true,
    dryRunIdle: true,
    observedAt: "2026-05-08T05:00:00.000Z",
    runCommandImpl: fakeCommand({ events, autoKill: { killSwitchActive: true } }),
    readJsonlImpl: emptyReceiptJsonl,
    readWalletSnapshotImpl: async () => walletWithIdleDust(),
    buildGatewayBtcConsolidationPlanImpl: async () => {
      buildCount += 1;
      throw new Error("should_not_build");
    },
  });

  assert.equal(report.phase, "idle_consolidation_preview");
  assert.equal(report.idleConsolidationPlan.status, "skipped_kill_switch_active");
  assert.equal(report.idleConsolidationPlan.candidates.length, 0);
  assert.equal(buildCount, 0);
});

test("all-chain autopilot resolves wallet address from canonical snapshot metadata for idle consolidation", async () => {
  const builtPlans = [];

  const report = await runAllChainAutopilot({
    execute: true,
    stopAfterRefill: true,
    observedAt: "2026-05-08T05:00:00.000Z",
    runCommandImpl: fakeCommand({ events: [] }),
    readJsonlImpl: emptyReceiptJsonl,
    readWalletSnapshotImpl: async () => walletWithNestedAddressOnly(),
    buildGatewayBtcConsolidationPlanImpl: async (args) => {
      builtPlans.push(args);
      return {
        schemaVersion: 1,
        observedAt: args.now,
        planStatus: "ready",
        strategyId: "gateway-btc-funding-transfer",
        route: { srcChain: args.srcChain, dstChain: args.dstChain },
        amount: args.amount,
        amountUsd: 7,
        intent: {
          strategyId: "gateway-btc-funding-transfer",
          chain: args.srcChain,
          intentId: `idle:${args.srcChain}`,
          intentType: "gateway_btc_transfer",
          amountUsd: 7,
          mode: "live",
          metadata: {},
        },
      };
    },
    executeGatewayBtcConsolidationPlanImpl: async () => ({ signerResult: { status: "queued" } }),
    appendSignerAuditRecordImpl: async () => "/tmp/signer-audit.jsonl",
  });

  assert.equal(
    report.idleConsolidationDispatches.some((item) => item.blockedReason === "wallet_address_unavailable"),
    false,
  );
  assert.equal(builtPlans.length, report.idleConsolidationPlan.candidates.length);
  assert.equal(
    builtPlans.every((plan) => plan.senderAddress === "0x2222222222222222222222222222222222222222"),
    true,
  );
});

test("all-chain autopilot blocks idle consolidation without trusted wallet owner address", async () => {
  let buildCount = 0;
  process.env.OPERATOR_EVM_ADDRESS = "0x4444444444444444444444444444444444444444";
  process.env.BURNER_EVM_ADDRESS = "0x5555555555555555555555555555555555555555";
  try {
    const report = await runAllChainAutopilot({
      execute: true,
      stopAfterRefill: true,
      observedAt: "2026-05-08T05:00:00.000Z",
      runCommandImpl: fakeCommand({ events: [] }),
      readJsonlImpl: emptyReceiptJsonl,
      readWalletSnapshotImpl: async () => walletWithoutTrustedOwnerAddress(),
      buildGatewayBtcConsolidationPlanImpl: async () => {
        buildCount += 1;
        throw new Error("should_not_build");
      },
    });

    assert.equal(report.idleConsolidationDispatches.length, report.idleConsolidationPlan.candidates.length);
    assert.equal(
      report.idleConsolidationDispatches.every((item) => item.blockedReason === "wallet_address_unavailable"),
      true,
    );
    assert.equal(buildCount, 0);
  } finally {
    delete process.env.OPERATOR_EVM_ADDRESS;
    delete process.env.BURNER_EVM_ADDRESS;
  }
});
