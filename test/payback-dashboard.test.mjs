import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BASE_USDC_TOKEN } from "../src/executor/helpers/gateway-btc-offramp.mjs";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import {
  appendExecutionReceiptReconciliation,
  loadLivePaybackReceiptStore,
} from "../src/executor/ingestor/execution-receipt-ingest.mjs";
import { buildPaybackDashboardSlice } from "../src/executor/payback/dashboard.mjs";

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
              minPaybackSats: 50_000,
            },
            decisionLog: {
              inputs: {
                grossProfitSatsPeriod: 250_000,
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
  assert.equal(payback.scheduler.status, "blocked");
  assert.equal(payback.scheduler.reason, "payback_btc_destination_missing");
  assert.equal(payback.scheduler.requiredEnvName, "PAYBACK_BTC_DEST_ADDR");
  assert.equal(payback.scheduler.nextAction, "set_payback_btc_destination_env");
  assert.equal(payback.scheduler.previewAfterDestination?.status, "carry");
  assert.equal(payback.scheduler.previewAfterDestination?.reason, "planned_payback_below_minimum");
  assert.equal(payback.scheduler.previewAfterDestination?.grossTargetBeforeCostsSats, 10_000);
  assert.equal(payback.scheduler.previewAfterDestination?.minPaybackSats, 50_000);
  assert.equal(payback.scheduler.previewAfterDestination?.satsToMinimumPayback, 40_000);
  assert.equal(payback.scheduler.previewAfterDestination?.progressToMinimumRatio, 0.2);
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
