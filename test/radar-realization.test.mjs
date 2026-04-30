import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpportunityRealizationRecord,
  summarizeRealizationRecords,
} from "../src/strategy/radar/realization-record-ingest.mjs";

const baseRecord = Object.freeze({
  runId: "run_realized",
  candidateId: "candidate_ready",
  entryReceipts: [{ chainId: 8453, txHash: "0xentry" }],
  claimReceipts: [],
  exitReceipts: [{ chainId: 8453, txHash: "0xexit" }],
  userOpHash: null,
  bundlerHash: null,
  gasCostSats: "10",
  bridgeCostSats: "0",
  swapSlippageSats: "2",
  rewardTokenHaircutSats: "0",
  grossPnlSats: "40",
  netRealizedPnlSats: "28",
  btcPaybackTxid: null,
  btcPaybackBlockHash: null,
  btcPaybackConfirmations: 0,
  pnlClosureStatus: "closed",
  sandwichDetectedPostTrade: false,
  priceImpactBps: 1,
  observedAt: "2026-04-30T13:00:00.000Z",
  settledAt: "2026-04-30T13:01:00.000Z",
});

test("buildOpportunityRealizationRecord validates strategy-realized records", () => {
  const result = buildOpportunityRealizationRecord(baseRecord);

  assert.equal(result.ok, true);
  assert.equal(result.record.lifecycle.strategyRealized, true);
  assert.equal(result.record.lifecycle.paybackDelivered, false);
});

test("summarizeRealizationRecords counts realized and payback-delivered states separately", () => {
  const realized = buildOpportunityRealizationRecord(baseRecord).record;
  const delivered = buildOpportunityRealizationRecord({
    ...baseRecord,
    runId: "run_delivered",
    btcPaybackTxid: "btc_txid",
    btcPaybackBlockHash: "btc_block",
    btcPaybackConfirmations: 6,
  }).record;

  const summary = summarizeRealizationRecords([realized, delivered]);

  assert.equal(summary.recordCount, 2);
  assert.equal(summary.strategyRealizedCount, 2);
  assert.equal(summary.paybackDeliveredCount, 1);
  assert.equal(summary.totalNetRealizedPnlSats, "56");
});

test("summarizeRealizationRecords tracks realized PnL separately from BTC-relative accounting", () => {
  const realized = buildOpportunityRealizationRecord({
    ...baseRecord,
    runId: "run_positive_pnl_negative_btc_relative",
    grossPnlUsd: 3,
    netRealizedPnlUsd: 2.5,
    grossPnlSats: "-300",
    netRealizedPnlSats: "-500",
  }).record;

  const summary = summarizeRealizationRecords([realized]);

  assert.equal(summary.strategyRealizedCount, 1);
  assert.equal(summary.positiveRealizedPnlCount, 1);
  assert.equal(summary.totalNetRealizedPnlUsd, 2.5);
  assert.equal(summary.totalNetRealizedPnlSats, "-500");
});
