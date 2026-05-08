import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { assertStrategyCaps } from "../src/config/strategy-caps.mjs";
import { runAllChainAutopilot } from "../src/executor/all-chain-autopilot.mjs";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";
import { handleIntentCommand } from "../src/executor/signer/daemon.mjs";
import { buildMerklCanaryQueue } from "../src/strategy/merkl-canary-queue.mjs";

const OBSERVED_AT = "2026-05-08T06:00:00.000Z";
const IDLE_CHAINS = ["bsc", "avalanche", "unichain", "sonic", "sei", "bera", "soneium", "bob"];

const emptyJsonl = async () => [];

function okJson(json = {}) {
  return { ok: true, exitCode: 0, stdout: JSON.stringify(json), stderr: "", json };
}

function fakeCommand({ autoKill = {} } = {}) {
  return async ({ args }) => {
    const name = args[0];
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

function mockWalletHoldings() {
  return {
    address: "0x1111111111111111111111111111111111111111",
    totalUsd: 1_000,
    items: [
      {
        sym: "yo",
        name: "yoUSD",
        chain: "base",
        amount: 800,
        usd: 800,
        family: "protocol",
        protocolId: "yo",
      },
      { sym: "USDC", name: "USDC", chain: "bsc", amount: 20, usd: 20, family: "token" },
      { sym: "RLUSD", name: "RLUSD", chain: "ethereum", amount: 25, usd: 25, family: "token" },
      { sym: "cbBTC", name: "cbBTC", chain: "base", amount: 0.0002, usd: 20, family: "token" },
      { sym: "ETH", name: "ETH", chain: "ethereum", amount: 0.01, usd: 20, family: "native" },
      ...IDLE_CHAINS.map((chain) => ({
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

function gatewayPlanFromCandidate(args) {
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
      intentId: `cycle4-idle:${args.srcChain}`,
      intentType: "gateway_btc_transfer",
      amountUsd: 7,
      expectedNetUsd: 1,
      mode: "live",
      observedAt: args.now,
      metadata: {},
    },
  };
}

function merklQuotaReport() {
  return {
    generatedAt: OBSERVED_AT,
    policyProfile: "aggressive_multi_asset_payback_v2",
    opportunities: [
      ...Array.from({ length: 3 }, (_, index) => ({
        opportunityId: `base-top-${index}`,
        decision: "candidate",
        validationMode: "tiny_live_canary_only",
        chain: "base",
        protocolId: "morpho",
        protocolName: "Morpho",
        name: `Base top ${index}`,
        family: "stable_treasury_carry",
        assetFamilies: ["stablecoin"],
        tokenSymbols: ["USDC"],
        hasStableExposure: true,
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        executionSurface: "stableCarry",
        campaignRemainingHours: 120,
        aprPct: 8,
        nativeAprPct: 8,
        tvlUsd: 5_000_000,
        score: 100 - index,
        overfitRisk: "minimal",
        overfitFlags: [],
        protocolBinding: {
          vaultAddress: `0x${String(index + 1).repeat(40)}`,
          assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      })),
      {
        opportunityId: "bsc-venus-usdc",
        decision: "candidate",
        validationMode: "tiny_live_canary_only",
        chain: "bsc",
        protocolId: "venus",
        protocolName: "Venus",
        name: "BSC Venus USDC",
        family: "stable_treasury_carry",
        assetFamilies: ["stablecoin"],
        tokenSymbols: ["USDC"],
        hasStableExposure: true,
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        executionSurface: "stableCarry",
        campaignRemainingHours: 120,
        aprPct: 5,
        nativeAprPct: 5,
        tvlUsd: 3_000_000,
        score: 10,
        overfitRisk: "minimal",
        overfitFlags: [],
        protocolBinding: {
          vaultAddress: "0x1111111111111111111111111111111111111111",
          assetAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        },
      },
    ],
  };
}

test("cycle 1-3 path plans idle dispatch, blocks over-concentration, clamps transport caps, and keeps BSC quota", async () => {
  const queuedPlans = [];
  const auditRecords = [];
  const report = await runAllChainAutopilot({
    execute: true,
    stopAfterRefill: true,
    observedAt: OBSERVED_AT,
    runCommandImpl: fakeCommand(),
    readJsonlImpl: emptyJsonl,
    readWalletSnapshotImpl: async () => mockWalletHoldings(),
    buildGatewayBtcConsolidationPlanImpl: async (args) => gatewayPlanFromCandidate(args),
    executeGatewayBtcConsolidationPlanImpl: async ({ plan }) => {
      queuedPlans.push(plan);
      return { signerResult: { status: "queued" } };
    },
    appendSignerAuditRecordImpl: async (record) => {
      auditRecords.push(record);
      return "/tmp/signer-audit.jsonl";
    },
  });

  const forbiddenAssetPattern = /yo|RLUSD|cbBTC|ETH|native/i;
  assert.equal(report.idleConsolidationPlan.status, "plan_ready");
  assert.ok(report.idleConsolidationPlan.candidates.length >= 1);
  assert.equal(report.idleConsolidationPlan.aggregateUsd, 50);
  assert.equal(
    report.idleConsolidationPlan.candidates.some((candidate) =>
      forbiddenAssetPattern.test(`${candidate.srcSym}:${candidate.srcChain}:${candidate.reason}`)
    ),
    false,
  );
  assert.equal(queuedPlans.length, report.idleConsolidationPlan.candidates.length);
  assert.equal(auditRecords.every((record) => record.lifecycle?.stage === "idle_consolidation_planned"), true);

  const concentrationPolicy = await evaluateIntentPolicies({
    now: OBSERVED_AT,
    activeBudgetUsd: null,
    intent: {
      strategyId: "gateway_native_asset_conversion_sleeve",
      chain: "base",
      family: "evm",
      intentType: "deposit",
      amountUsd: 1,
      expectedNetUsd: 1,
      mode: "live",
      observedAt: OBSERVED_AT,
      metadata: {},
    },
    riskContext: {
      totalOperatingCapitalUsd: 1_000,
      currentAllocations: {
        perStrategy: {},
        perChain: { base: 0.8, bsc: 0.02 },
        perProtocol: {},
        bobL2DirectShare: 0,
      },
    },
  });
  const concentrationGuard = concentrationPolicy.results.find((item) => item.policy === "concentration_guard");
  assert.equal(concentrationGuard.decision, "BLOCK");
  assert.equal(concentrationGuard.verdict.violations.some((item) => item.kind === "per_chain_share_exceeded"), true);

  const transportCaps = assertStrategyCaps("gateway-btc-funding-transfer", { activeCapitalUsd: 500 });
  assert.equal(transportCaps.caps.perDayUsd, 200);
  assert.equal(transportCaps.caps.maxDailyLossUsd, 100);

  const merklQueue = buildMerklCanaryQueue({
    report: merklQuotaReport(),
    limit: 2,
    now: OBSERVED_AT,
    inventorySnapshot: { native: [], tokens: [] },
  });
  assert.ok(merklQueue.summary.byChain.bsc >= 1);

  console.log(JSON.stringify({
    case: "A",
    idleConsolidation: {
      status: report.idleConsolidationPlan.status,
      plannedCandidates: report.idleConsolidationPlan.candidates.length,
      aggregateUsd: report.idleConsolidationPlan.aggregateUsd,
      queuedIntentCount: queuedPlans.length,
    },
    concentrationGuard: {
      decision: concentrationGuard.decision,
      violations: concentrationGuard.verdict.violations.map((item) => item.kind),
    },
    transportCaps: {
      strategyId: "gateway-btc-funding-transfer",
      perDayUsd: transportCaps.caps.perDayUsd,
      maxDailyLossUsd: transportCaps.caps.maxDailyLossUsd,
    },
    merklChainQuota: {
      bsc: merklQueue.summary.byChain.bsc,
    },
  }));
});

test("cycle 1-3 path blocks idle dispatch when kill-switch is active", async () => {
  let buildCount = 0;
  let broadcastCount = 0;
  const report = await runAllChainAutopilot({
    execute: true,
    stopAfterRefill: true,
    observedAt: OBSERVED_AT,
    runCommandImpl: fakeCommand({ autoKill: { killSwitchActive: true } }),
    readJsonlImpl: emptyJsonl,
    readWalletSnapshotImpl: async () => mockWalletHoldings(),
    buildGatewayBtcConsolidationPlanImpl: async () => {
      buildCount += 1;
      throw new Error("idle_builder_should_not_run");
    },
    executeGatewayBtcConsolidationPlanImpl: async () => {
      broadcastCount += 1;
      throw new Error("broadcast_should_not_run");
    },
  });

  assert.equal(report.idleConsolidationPlan.status, "skipped_kill_switch_active");
  assert.equal(report.idleConsolidationPlan.candidates.length, 0);
  assert.equal(buildCount, 0);
  assert.equal(broadcastCount, 0);
});

test("cycle 1-3 daemon uses metadata risk budget instead of wallet total fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-cycle-1-3-daemon-"));
  const killSwitchPath = join(root, "KILL_SWITCH");
  let signCount = 0;
  const fakeSigner = {
    signIntent: async () => {
      signCount += 1;
      return { txHash: "0x" + "6".repeat(64), signedTx: "0xdeadbeef" };
    },
  };

  try {
    const result = await handleIntentCommand({
      message: {
        command: "sign_only",
        intent: {
          strategyId: "gateway_native_asset_conversion_sleeve",
          chain: "base",
          family: "evm",
          intentType: "deposit",
          amountUsd: 200,
          expectedNetUsd: 10,
          mode: "live",
          observedAt: OBSERVED_AT,
          quote: { observedAt: OBSERVED_AT, maxAgeMs: 365 * 24 * 60 * 60 * 1000 },
          metadata: {
            skipAutoIngest: true,
            riskContext: {
              totalOperatingCapitalUsd: 1_000,
              currentAllocations: {
                perChain: { base: 0.1 },
              },
            },
          },
        },
      },
      signers: { evm: fakeSigner },
      args: {
        activeBudgetUsd: null,
        killSwitchPath,
        autoIngest: false,
      },
      cwd: root,
      loadRuntimeRiskContextImpl: async () => ({
        totalOperatingCapitalUsd: 357,
        currentAllocations: {
          perStrategy: {},
          perChain: { base: 0.8, bsc: 0.02 },
          perProtocol: {},
          bobL2DirectShare: 0,
        },
      }),
    });

    assert.equal(result.status, "ok");
    assert.equal(signCount, 1);
    const concentrationGuard = result.policy.results.find((item) => item.policy === "concentration_guard");
    assert.equal(concentrationGuard.decision, "ALLOW");
    assert.ok(Math.abs(concentrationGuard.verdict.details.projectedAllocations.perChain.base - 0.3) < 1e-9);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
