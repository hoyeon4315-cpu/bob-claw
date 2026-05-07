import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BASE_USDC_TOKEN } from "../src/executor/helpers/gateway-btc-offramp.mjs";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import {
  appendExecutionReceiptReconciliation,
  loadLivePaybackReceiptStore,
} from "../src/executor/ingestor/execution-receipt-ingest.mjs";
import {
  buildPaybackDashboardSlice,
  buildProposedMinPaybackPatch,
} from "../src/executor/payback/dashboard.mjs";

function nativePriceFixture() {
  return {
    btc: 100_000,
    tokenByKey: {
      btc: 100_000,
      usd_stable: 1,
    },
    nativeByChain: {
      base: 2_000,
    },
  };
}

test("execution receipt ingest appends once and dedupes repeated live execution records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-receipt-ingest-"));
  const execution = {
    observedAt: "2026-04-17T15:00:00.000Z",
    plan: {
      strategyId: "token-dex-experiment",
      chain: "base",
      inputToken: WBTC_OFT_TOKEN,
      outputToken: BASE_USDC_TOKEN,
      amount: "10000",
      amountUsd: 7.5,
      quote: {
        inputValueUsd: 7.5,
        outputValueUsd: 7.6,
        netOutputValueUsd: 7.58,
        gasEstimateValueUsd: 0.01,
      },
      steps: [
        {
          id: "approve_input_token",
          intent: {
            tx: {
              to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              value: "0",
            },
          },
        },
        {
          id: "swap_input_to_output",
          intent: {
            tx: {
              to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              value: "0",
            },
          },
        },
      ],
    },
    stepResults: [
      {
        id: "approve_input_token",
        signerResult: {
          broadcast: {
            txHash: "0xabc122",
          },
          signed: {
            metadata: {
              from: "0x1111111111111111111111111111111111111111",
              to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              nonce: 6,
            },
          },
          receipt: {
            status: 1,
            gasUsed: "1000",
            effectiveGasPrice: "1000000000",
            from: "0x1111111111111111111111111111111111111111",
            to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
      },
      {
        id: "swap_input_to_output",
        signerResult: {
          broadcast: {
            txHash: "0xabc123",
          },
          signed: {
            metadata: {
              from: "0x1111111111111111111111111111111111111111",
              to: "0x2222222222222222222222222222222222222222",
              nonce: 7,
            },
          },
          receipt: {
            status: 1,
            gasUsed: "2000",
            effectiveGasPrice: "2000000000",
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
          },
        },
      },
    ],
    destinationProof: {
      observedDelta: "7600000",
      status: "delivered",
    },
  };

  const first = await appendExecutionReceiptReconciliation({
    execution,
    dataDir,
    priceReader: async () => nativePriceFixture(),
  });
  const second = await appendExecutionReceiptReconciliation({
    execution,
    dataDir,
    priceReader: async () => nativePriceFixture(),
  });

  assert.equal(first.appended, true);
  assert.equal(first.receiptRecord.reconciliationStatus, "reconciled");
  assert.equal(first.receiptRecord.realized.receiptGasUsd, 0.01);
  assert.ok(Math.abs(first.receiptRecord.realized.realizedNetPnlUsd - 0.09) < 1e-9);
  assert.equal(first.receiptRecord.realized.realizedNetPnlSats, 90);
  assert.equal(first.receiptRecord.pricing.btcUsd, 100_000);
  assert.equal(second.appended, false);
  assert.equal(second.reason, "already_ingested");
});

test("payback loader excludes simulated dry-run loop receipts and dashboard slice stays sats-first", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-payback-dashboard-"));
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, "wrapped-btc-loop-dry-runs.jsonl"),
    [
      JSON.stringify({
        observedAt: "2026-04-17T10:00:00.000Z",
        executionMode: "simulated_dry_run",
        realizedNetCarryUsd: 5.5,
      }),
      JSON.stringify({
        observedAt: "2026-04-17T11:00:00.000Z",
        executionMode: "signer_backed_receipt",
        realizedNetCarryUsd: 4,
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeFile(
    join(dataDir, "market-price-snapshots.jsonl"),
    `${JSON.stringify({
      observedAt: "2026-04-17T11:05:00.000Z",
      btcUsd: 100_000,
      tokenByKey: { btc: 100_000, usd_stable: 1 },
      nativeByChain: { base: 2_000 },
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(dataDir, "treasury-inventory.jsonl"),
    `${JSON.stringify({
      observedAt: "2026-04-17T11:06:00.000Z",
      native: [],
      tokens: [
        {
          chain: "base",
          ticker: "wBTC.OFT",
          actual: "20000",
          actualDecimal: 0.0002,
          priceUsd: 100_000,
        },
      ],
    })}\n`,
    "utf8",
  );

  const receiptStore = await loadLivePaybackReceiptStore({ dataDir });
  assert.equal(receiptStore.wrappedBtcLoopReceipts.length, 1);
  assert.equal(receiptStore.wrappedBtcLoopReceipts[0].executionMode, "signer_backed_receipt");

  const payback = await buildPaybackDashboardSlice({
    dataDir,
    auditLogLines: [],
    receiptStore,
    now: "2026-04-17T12:00:00.000Z",
    decisionBuilder: async ({ recipientOverride } = {}) => (
      recipientOverride
        ? {
            status: "carry",
            reason: "planned_payback_below_minimum",
            policy: {
              baseRatio: 0.2,
              minPaybackSats: 50_000,
            },
            decisionLog: {
              inputs: {
                grossProfitSatsPeriod: 250_000,
                baseRatio: 0.2,
                regimeMultiplier: 1,
                volMultiplier: 1,
                grossTargetBeforeCostsSats: 10_000,
                minPaybackSats: 50_000,
              },
            },
          }
        : {
            status: "blocked",
            reason: "payback_btc_destination_missing",
            decisionLog: {
              inputs: {
                bitcoinDestAddressEnv: "PAYBACK_BTC_DEST_ADDR",
              },
            },
          }
    ),
  });

  assert.equal(payback.lastPaybackSettledAt, null);
  assert.equal(payback.lastPaybackSettledSats, null);
  assert.ok(payback.accumulatorPendingSats > 0);
  assert.ok(payback.grossProfitSatsPeriod > 0);
  assert.equal(payback.profitSatsProvenance.period.directSats, 0);
  assert.ok(payback.profitSatsProvenance.period.projectedSats > 0);
  assert.equal(payback.carry.pendingSatsProvenance.projectedSats, payback.accumulatorPendingSats);
  assert.equal(payback.scheduler.status, "blocked");
  assert.equal(payback.scheduler.reason, "payback_btc_destination_missing");
  assert.equal(payback.scheduler.requiredEnvName, "PAYBACK_BTC_DEST_ADDR");
  assert.equal(payback.scheduler.nextAction, "set_payback_btc_destination_env");
  assert.equal(payback.scheduler.minimumPaybackProgress?.source, "after_destination");
  assert.equal(payback.scheduler.minimumPaybackProgress?.reason, "planned_payback_below_minimum");
  assert.equal(payback.scheduler.minimumPaybackProgress?.requiredGrossProfitSats, 250_000);
  assert.equal(payback.scheduler.minimumPaybackProgress?.satsToMinimumPayback, 40_000);
  assert.equal(payback.scheduler.minimumPaybackProgress?.progressToMinimumRatio, 0.2);
  assert.equal(payback.scheduler.previewAfterDestination?.status, "carry");
  assert.equal(payback.scheduler.previewAfterDestination?.reason, "planned_payback_below_minimum");
  assert.equal(payback.scheduler.previewAfterDestination?.requiredGrossProfitSats, 250_000);
  assert.equal(payback.scheduler.previewAfterDestination?.grossTargetBeforeCostsSats, 10_000);
  assert.equal(payback.scheduler.previewAfterDestination?.minPaybackSats, 50_000);
  assert.equal(payback.scheduler.previewAfterDestination?.satsToMinimumPayback, 40_000);
  assert.equal(payback.scheduler.previewAfterDestination?.progressToMinimumRatio, 0.2);
  assert.equal(payback.carry.active, false);
  assert.equal(payback.carry.pendingSats, payback.accumulatorPendingSats);
});

test("payback dashboard exposes current minimum payback gap when destination is already configured", async () => {
  const payback = await buildPaybackDashboardSlice({
    auditLogLines: [],
    receiptStore: {
      receiptReconciliations: [],
      treasuryInventory: [],
      marketPriceSnapshots: [],
      wrappedBtcLoopReceipts: [],
      wrappedBtcLoopLiveProofs: [],
    },
    now: "2026-04-17T12:00:00.000Z",
    decisionBuilder: async () => ({
      status: "carry",
      reason: "planned_payback_below_minimum",
      policy: {
        baseRatio: 0.2,
        minPaybackSats: 50_000,
      },
      decisionLog: {
        inputs: {
          grossProfitSatsPeriod: 289,
          baseRatio: 0.2,
          regimeMultiplier: 1,
          volMultiplier: 1,
          grossTargetBeforeCostsSats: 58,
          minPaybackSats: 50_000,
        },
      },
    }),
  });

  assert.equal(payback.scheduler.status, "carry");
  assert.equal(payback.scheduler.reason, "planned_payback_below_minimum");
  assert.equal(payback.scheduler.previewAfterDestination, null);
  assert.equal(payback.scheduler.minimumPaybackProgress?.source, "current");
  assert.equal(payback.scheduler.minimumPaybackProgress?.status, "carry");
  assert.equal(payback.scheduler.minimumPaybackProgress?.reason, "planned_payback_below_minimum");
  assert.equal(payback.scheduler.minimumPaybackProgress?.requiredGrossProfitSats, 250_000);
  assert.equal(payback.scheduler.minimumPaybackProgress?.grossTargetBeforeCostsSats, 58);
  assert.equal(payback.scheduler.minimumPaybackProgress?.minPaybackSats, 50_000);
  assert.equal(payback.scheduler.minimumPaybackProgress?.satsToMinimumPayback, 49_942);
  assert.equal(payback.scheduler.minimumPaybackProgress?.progressToMinimumRatio, 58 / 50_000);
  assert.equal(payback.carry.active, true);
  assert.equal(payback.carry.reason, "planned_payback_below_minimum");
  assert.equal(payback.carry.remainingSatsToMinimum, 49_942);
});

test("payback dashboard exposes reserve restoration next action when reserve asset is missing", async () => {
  const payback = await buildPaybackDashboardSlice({
    auditLogLines: [],
    receiptStore: {
      receiptReconciliations: [],
      treasuryInventory: [],
      marketPriceSnapshots: [],
      wrappedBtcLoopReceipts: [],
      wrappedBtcLoopLiveProofs: [],
    },
    now: "2026-04-17T12:00:00.000Z",
    decisionBuilder: async () => ({
      status: "defer",
      reason: "reserve_asset_missing",
      policy: {
        destinationPath: {
          profitReserveChain: "base",
        },
      },
      decisionLog: {
        inputs: {},
      },
    }),
  });

  assert.equal(payback.scheduler.status, "defer");
  assert.equal(payback.scheduler.reason, "reserve_asset_missing");
  assert.equal(payback.scheduler.nextAction, "restore_profit_reserve_wbtc_oft");
});

test("payback dashboard prefers destination settlement time for last settled timestamp", async () => {
  const payback = await buildPaybackDashboardSlice({
    auditLogLines: [],
    receiptStore: {
      receiptReconciliations: [
        {
          observedAt: "2026-04-17T11:00:00.000Z",
          plan: {
            strategyId: "gateway-btc-offramp",
            intent: {
              intentType: "gateway_btc_offramp",
              metadata: {
                gatewayOrderId: "order-1",
              },
            },
            order: {
              orderId: "order-1",
            },
          },
          signerResult: {
            broadcast: {
              txHash: "0xabc",
            },
          },
          settlementStatus: "delivered",
          destinationProof: {
            status: "delivered",
            observedAt: "2026-04-17T11:30:00.000Z",
            observedDelta: "1234",
            bitcoinTxid: "btc123",
          },
        },
      ],
      treasuryInventory: [],
      marketPriceSnapshots: [],
      wrappedBtcLoopReceipts: [],
      wrappedBtcLoopLiveProofs: [],
    },
    now: "2026-04-17T12:00:00.000Z",
    decisionBuilder: async () => ({
      status: "plan",
      reason: "planning_required",
      decisionLog: {
        inputs: {},
      },
    }),
  });

  assert.equal(payback.lastPaybackSettledAt, "2026-04-17T11:30:00.000Z");
  assert.equal(payback.lastPaybackSettledSats, 1234);
  assert.equal(payback.scheduler.status, "plan");
  assert.equal(payback.scheduler.reason, "planning_required");
});

test("payback dashboard estimates periods to first payback for both committed sleeve profiles", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-payback-forecast-"));
  const now = "2026-04-17T12:00:00.000Z";
  const payback = await buildPaybackDashboardSlice({
    dataDir,
    auditLogLines: [],
    receiptStore: {
      receiptReconciliations: [
        {
          observedAt: "2026-04-10T12:00:00.000Z",
          realized: {
            realizedNetPnlUsd: 10,
          },
        },
      ],
      treasuryInventory: [],
      marketPriceSnapshots: [
        {
          observedAt: "2026-04-17T11:05:00.000Z",
          btcUsd: 100_000,
          tokenByKey: { btc: 100_000, usd_stable: 1 },
          nativeByChain: { base: 2_000 },
        },
      ],
      wrappedBtcLoopReceipts: [],
      wrappedBtcLoopLiveProofs: [],
    },
    now,
    decisionBuilder: async () => ({
      status: "carry",
      reason: "planned_payback_below_minimum",
      policy: {
        baseRatio: 0.2,
        minPaybackSats: 50_000,
      },
      decisionLog: {
        inputs: {
          grossProfitSatsPeriod: 289,
          baseRatio: 0.2,
          regimeMultiplier: 1,
          volMultiplier: 1,
          grossTargetBeforeCostsSats: 58,
          minPaybackSats: 50_000,
        },
      },
    }),
  });

  const estimate = payback.estimatedPeriodsToFirstPayback;
  assert.equal(estimate.windowDays, 30);
  assert.equal(estimate.periodDays, 7);
  assert.equal(estimate.schedulerCronExpression, "0 0 * * 1");
  assert.equal(estimate.activeProfileId, "smallCapital_v1");
  assert.equal(estimate.requiredGrossProfitSats, 250_000);
  assert.equal(estimate.realizedGrossProfitSatsWindow, 10_000);
  assert.equal(estimate.observedPeriods, 4.29);
  assert.equal(estimate.realizedGrossProfitSatsPerPeriod, 2333.33);
  assert.equal(estimate.realizedGrossProfitSatsPeriodMedian, 10_000);
  assert.equal(estimate.realizedGrossProfitPeriodSampleCount, 1);

  assert.equal(estimate.profiles.smallCapital_v1.status, "estimated");
  assert.equal(estimate.profiles.smallCapital_v1.reason, null);
  assert.equal(estimate.profiles.smallCapital_v1.profileSettlementTargetUsd, 650);
  assert.equal(estimate.profiles.smallCapital_v1.scalingRatio, 1);
  assert.equal(estimate.profiles.smallCapital_v1.projectedGrossProfitSatsPerPeriod, 2333.33);
  assert.equal(estimate.profiles.smallCapital_v1.projectedMedianGrossProfitSatsPerPeriod, 10_000);
  assert.equal(estimate.profiles.smallCapital_v1.medianEstimatedPeriods, 25);
  assert.equal(estimate.profiles.smallCapital_v1.estimatedPeriods, 107.14);

  assert.equal(estimate.profiles.aggressive_v1.status, "estimated");
  assert.equal(estimate.profiles.aggressive_v1.reason, null);
  assert.equal(estimate.profiles.aggressive_v1.profileSettlementTargetUsd, 1040);
  assert.equal(estimate.profiles.aggressive_v1.scalingRatio, 1.6);
  assert.equal(estimate.profiles.aggressive_v1.projectedGrossProfitSatsPerPeriod, 3733.33);
  assert.equal(estimate.profiles.aggressive_v1.projectedMedianGrossProfitSatsPerPeriod, 16_000);
  assert.equal(estimate.profiles.aggressive_v1.medianEstimatedPeriods, 15.63);
  assert.equal(estimate.profiles.aggressive_v1.estimatedPeriods, 66.96);
  assert.equal(payback.proposedMinPaybackPatch, "data/payback/proposed-min-payback-diff.patch");
  assert.equal(payback.minimumReview.status, "propose_patch");
  assert.equal(payback.minimumReview.reason, "both_profiles_above_threshold");
  assert.equal(payback.minimumReview.proposedPatchPath, "data/payback/proposed-min-payback-diff.patch");
  assert.equal(payback.minimumReview.profiles.smallCapital_v1.estimatedPeriods, 107.14);
  assert.equal(payback.minimumReview.profiles.smallCapital_v1.medianEstimatedPeriods, 25);
  assert.equal(payback.minimumReview.profiles.aggressive_v1.estimatedPeriods, 66.96);
  assert.equal(payback.minimumReview.profiles.aggressive_v1.medianEstimatedPeriods, 15.63);
});

test("payback dashboard writes deterministic PR-only minimum-payback patch when both profiles stay above threshold", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-payback-patch-"));
  const payback = await buildPaybackDashboardSlice({
    dataDir,
    auditLogLines: [],
    receiptStore: {
      receiptReconciliations: [
        {
          observedAt: "2026-04-10T12:00:00.000Z",
          realized: {
            realizedNetPnlUsd: 10,
          },
        },
      ],
      treasuryInventory: [],
      marketPriceSnapshots: [
        {
          observedAt: "2026-04-17T11:05:00.000Z",
          btcUsd: 100_000,
          tokenByKey: { btc: 100_000, usd_stable: 1 },
          nativeByChain: { base: 2_000 },
        },
      ],
      wrappedBtcLoopReceipts: [],
      wrappedBtcLoopLiveProofs: [],
    },
    now: "2026-04-17T12:00:00.000Z",
    decisionBuilder: async () => ({
      status: "carry",
      reason: "planned_payback_below_minimum",
      policy: {
        baseRatio: 0.2,
        minPaybackSats: 50_000,
      },
      decisionLog: {
        inputs: {
          grossProfitSatsPeriod: 289,
          baseRatio: 0.2,
          regimeMultiplier: 1,
          volMultiplier: 1,
          grossTargetBeforeCostsSats: 58,
          minPaybackSats: 50_000,
        },
      },
    }),
  });

  assert.equal(payback.proposedMinPaybackPatch, "data/payback/proposed-min-payback-diff.patch");
  const expected = buildProposedMinPaybackPatch();
  const actual = await readFile(join(dataDir, "payback", "proposed-min-payback-diff.patch"), "utf8");
  assert.equal(actual, expected);
});

test("payback dashboard leaves periods-to-first-payback unavailable when realized run rate is non-positive", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-payback-forecast-empty-"));
  const payback = await buildPaybackDashboardSlice({
    dataDir,
    auditLogLines: [],
    receiptStore: {
      receiptReconciliations: [],
      treasuryInventory: [],
      marketPriceSnapshots: [
        {
          observedAt: "2026-04-17T11:05:00.000Z",
          btcUsd: 100_000,
          tokenByKey: { btc: 100_000, usd_stable: 1 },
          nativeByChain: { base: 2_000 },
        },
      ],
      wrappedBtcLoopReceipts: [],
      wrappedBtcLoopLiveProofs: [],
    },
    now: "2026-04-17T12:00:00.000Z",
    decisionBuilder: async () => ({
      status: "carry",
      reason: "planned_payback_below_minimum",
      policy: {
        baseRatio: 0.2,
        minPaybackSats: 50_000,
      },
      decisionLog: {
        inputs: {
          grossProfitSatsPeriod: 289,
          baseRatio: 0.2,
          regimeMultiplier: 1,
          volMultiplier: 1,
          grossTargetBeforeCostsSats: 58,
          minPaybackSats: 50_000,
        },
      },
    }),
  });

  const estimate = payback.estimatedPeriodsToFirstPayback;
  assert.equal(estimate.realizedGrossProfitSatsWindow, 0);
  assert.equal(estimate.realizedGrossProfitSatsPerPeriod, 0);
  assert.equal(estimate.profiles.smallCapital_v1.status, "unavailable");
  assert.equal(estimate.profiles.smallCapital_v1.reason, "non_positive_realized_run_rate");
  assert.equal(estimate.profiles.smallCapital_v1.estimatedPeriods, null);
  assert.equal(estimate.profiles.aggressive_v1.status, "unavailable");
  assert.equal(estimate.profiles.aggressive_v1.reason, "non_positive_realized_run_rate");
  assert.equal(estimate.profiles.aggressive_v1.estimatedPeriods, null);
  // A non-positive realized run rate trivially exceeds the eight-period
  // proposal threshold, so the dashboard surfaces a PR-draft patch even
  // though the projected periods themselves are unbounded. The patch is a
  // PR draft, never a runtime change.
  assert.equal(payback.proposedMinPaybackPatch, "data/payback/proposed-min-payback-diff.patch");
  assert.equal(payback.minimumReview.status, "propose_patch");
  assert.equal(payback.minimumReview.reason, "both_profiles_non_positive_run_rate");
  assert.equal(payback.minimumReview.proposedPatchPath, "data/payback/proposed-min-payback-diff.patch");
  assert.equal(payback.minimumReview.profiles.smallCapital_v1.reason, "non_positive_realized_run_rate");
  assert.equal(payback.minimumReview.profiles.aggressive_v1.reason, "non_positive_realized_run_rate");
  const patchContents = await readFile(join(dataDir, "payback", "proposed-min-payback-diff.patch"), "utf8");
  assert.match(patchContents, /both_profiles_non_positive_run_rate/u);
  assert.match(patchContents, /non-positive realized run rate/u);
  assert.match(patchContents, /PR draft only/u);
});

test("payback dashboard treats explicit zero payback-eligible sats as authoritative over positive USD fallback", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-payback-explicit-zero-"));
  const payback = await buildPaybackDashboardSlice({
    dataDir,
    auditLogLines: [],
    receiptStore: {
      receiptReconciliations: [
        {
          observedAt: "2026-04-17T10:00:00.000Z",
          pnl: {
            paybackEligibleRealizedPnlSats: 0,
          },
          realized: {
            realizedNetPnlUsd: 3,
          },
        },
      ],
      treasuryInventory: [],
      marketPriceSnapshots: [
        {
          observedAt: "2026-04-17T09:55:00.000Z",
          btcUsd: 100_000,
          tokenByKey: { btc: 100_000, usd_stable: 1 },
          nativeByChain: { base: 2_000 },
        },
      ],
      wrappedBtcLoopReceipts: [],
      wrappedBtcLoopLiveProofs: [],
    },
    now: "2026-04-17T12:00:00.000Z",
    decisionBuilder: async () => ({
      status: "carry",
      reason: "planned_payback_below_minimum",
      policy: {
        baseRatio: 0.2,
        minPaybackSats: 50_000,
      },
      decisionLog: {
        inputs: {
          grossProfitSatsPeriod: 289,
          baseRatio: 0.2,
          regimeMultiplier: 1,
          volMultiplier: 1,
          grossTargetBeforeCostsSats: 58,
          minPaybackSats: 50_000,
        },
      },
    }),
  });

  const estimate = payback.estimatedPeriodsToFirstPayback;
  assert.equal(estimate.realizedGrossProfitSatsWindow, 0);
  assert.equal(estimate.realizedGrossProfitSatsPerPeriod, 0);
  assert.equal(estimate.realizedGrossProfitSatsPeriodMedian, 0);
  assert.equal(estimate.realizedGrossProfitPeriodSampleCount, 1);
  assert.equal(estimate.profiles.smallCapital_v1.reason, "non_positive_realized_run_rate");
  assert.equal(estimate.profiles.smallCapital_v1.medianEstimatedPeriods, null);
  assert.equal(estimate.profiles.aggressive_v1.reason, "non_positive_realized_run_rate");
  assert.equal(estimate.profiles.aggressive_v1.medianEstimatedPeriods, null);
  // Same proposal trigger as above: explicit zero payback-eligible sats means
  // the realized run rate is non-positive in both profiles.
  assert.equal(payback.proposedMinPaybackPatch, "data/payback/proposed-min-payback-diff.patch");
  assert.equal(payback.minimumReview.status, "propose_patch");
  assert.equal(payback.minimumReview.reason, "both_profiles_non_positive_run_rate");
});

test("payback dashboard surfaces a proposed patch path in read-only mode when both profiles report a non-positive realized run rate", async () => {
  const payback = await buildPaybackDashboardSlice({
    auditLogLines: [],
    receiptStore: {
      receiptReconciliations: [],
      treasuryInventory: [],
      marketPriceSnapshots: [
        {
          observedAt: "2026-04-17T11:05:00.000Z",
          btcUsd: 100_000,
          tokenByKey: { btc: 100_000, usd_stable: 1 },
          nativeByChain: { base: 2_000 },
        },
      ],
      wrappedBtcLoopReceipts: [],
      wrappedBtcLoopLiveProofs: [],
    },
    now: "2026-04-17T12:00:00.000Z",
    writeProposedPatch: false,
    decisionBuilder: async () => ({
      status: "carry",
      reason: "planned_payback_below_minimum",
      policy: {
        baseRatio: 0.2,
        minPaybackSats: 50_000,
      },
      decisionLog: {
        inputs: {
          grossProfitSatsPeriod: 289,
          baseRatio: 0.2,
          regimeMultiplier: 1,
          volMultiplier: 1,
          grossTargetBeforeCostsSats: 58,
          minPaybackSats: 50_000,
        },
      },
    }),
  });

  // Read-only mode advertises the patch path so dashboards can link to it,
  // but no file is materialised on disk because dataDir was not provided.
  assert.equal(payback.proposedMinPaybackPatch, "data/payback/proposed-min-payback-diff.patch");
  assert.equal(payback.minimumReview.status, "propose_patch");
  assert.equal(payback.minimumReview.reason, "both_profiles_non_positive_run_rate");
  assert.equal(payback.minimumReview.proposedPatchPath, "data/payback/proposed-min-payback-diff.patch");
});

test("buildProposedMinPaybackPatch annotates the trigger and rationale for operator review", () => {
  const aboveThreshold = buildProposedMinPaybackPatch({ trigger: "both_profiles_above_threshold" });
  assert.match(aboveThreshold, /^# Trigger: both_profiles_above_threshold$/mu);
  assert.match(aboveThreshold, /both committed sleeve profiles forecast at least eight periods/u);
  assert.match(aboveThreshold, /PR draft only/u);

  const nonPositive = buildProposedMinPaybackPatch({ trigger: "both_profiles_non_positive_run_rate" });
  assert.match(nonPositive, /^# Trigger: both_profiles_non_positive_run_rate$/mu);
  assert.match(nonPositive, /non-positive realized run rate/u);

  const fallback = buildProposedMinPaybackPatch({ trigger: "unknown_trigger" });
  // Unknown triggers fall back to the default rationale rather than throwing.
  assert.match(fallback, /both committed sleeve profiles forecast at least eight periods/u);
  assert.match(fallback, /^# Trigger: unknown_trigger$/mu);
});
