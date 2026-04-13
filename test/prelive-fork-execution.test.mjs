import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildForkExecutionJob,
  buildForkExecutionPlan,
  buildForkExecutionSummary,
  buildForkOutputResolutionCommand,
} from "../src/prelive/fork-execution.mjs";

const WBTC = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

test("fork execution plan captures external signed transaction requirements", () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `ethereum:${WBTC}->base:${WBTC}`,
      amount: "10000",
      source: "objective_execution_review",
      sourceLabel: "execution_review",
      reason: "wallet_ready",
      code: "simulate_execution_path",
      queueRank: 1,
      label: "ethereum->base",
      score: {
        routeKey: `ethereum:${WBTC}->base:${WBTC}`,
        amount: "10000",
        srcChain: "ethereum",
        dstChain: "base",
        inputUsd: 7.3,
        outputUsd: 7.9,
        executableNetEdgeUsd: 0.4,
        tradeReadiness: "shadow_candidate_review_only",
        srcAsset: { chain: "ethereum", token: WBTC, ticker: "WBTC", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "base", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `ethereum:${WBTC}->base:${WBTC}`,
        amount: "10000",
        route: { srcChain: "ethereum", dstChain: "base" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "0",
        txDataBytes: 2,
      },
    },
    address: "0x000000000000000000000000000000000000dEaD",
    now: "2026-04-12T11:00:00.000Z",
  });

  assert.equal(plan.status, "planned");
  assert.equal(plan.signer.mode, "external_signed_raw_tx");
  assert.equal(plan.signer.storesPrivateKey, false);
  assert.equal(plan.transaction.to, "0x1111111111111111111111111111111111111111");
  assert.match(plan.commands.submit, /submit:prelive-fork-execution/);
  assert.match(plan.commands.resolveOutput, /actual-output-units/);

  const job = buildForkExecutionJob(plan);
  assert.equal(job.jobId, plan.planId);
  assert.equal(job.executionMethod, "external_signed_raw_tx");
});

test("fork execution plan is blocked when quote payload is incomplete", () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `ethereum:${WBTC}->base:${WBTC}`,
      amount: "10000",
      quote: {
        routeKey: `ethereum:${WBTC}->base:${WBTC}`,
        amount: "10000",
        route: { srcChain: "ethereum", dstChain: "base" },
        txTo: null,
        txData: null,
      },
    },
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.blockers.includes("missing_tx_to"), true);
  assert.equal(plan.blockers.includes("missing_tx_data"), true);
});

test("fork execution summary reports counts and remaining confirmations", () => {
  const summary = buildForkExecutionSummary({
    plans: [
      { observedAt: "2026-04-12T11:00:00.000Z", planId: "p1", routeLabel: "ethereum->base", routeKey: "r1", amount: "10000", status: "planned", selectionSource: "objective" },
    ],
    submissions: [
      { observedAt: "2026-04-12T11:01:00.000Z", planId: "p1", routeLabel: "ethereum->base", amount: "10000", chain: "ethereum", submissionStatus: "submitted" },
      { observedAt: "2026-04-12T11:02:00.000Z", planId: "p2", routeLabel: "ethereum->unichain", amount: "10000", chain: "ethereum", submissionStatus: "failed" },
    ],
    receipts: [
      { observedAt: "2026-04-12T11:03:00.000Z", planId: "p1", routeLabel: "ethereum->base", amount: "10000", reconciliationStatus: "reconciled", flags: { failed: false } },
    ],
    targetConfirmedCount: 2,
  });

  assert.equal(summary.planCount, 1);
  assert.equal(summary.submittedCount, 1);
  assert.equal(summary.submissionFailureCount, 1);
  assert.equal(summary.confirmedCount, 1);
  assert.equal(summary.successRemaining, 1);
  assert.equal(summary.latestPlan.routeLabel, "ethereum->base");
});

test("fork execution summary surfaces pending output resolution details", () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `ethereum:${WBTC}->base:${WBTC}`,
      amount: "10000",
      label: "ethereum->base",
      score: {
        routeKey: `ethereum:${WBTC}->base:${WBTC}`,
        amount: "10000",
        srcChain: "ethereum",
        dstChain: "base",
        inputUsd: 7.3,
        outputUsd: 7.9,
        executableNetEdgeUsd: 0.4,
        tradeReadiness: "shadow_candidate_review_only",
        price: { dstRawUsd: 73000 },
        srcAsset: { chain: "ethereum", token: WBTC, ticker: "WBTC", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "base", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `ethereum:${WBTC}->base:${WBTC}`,
        amount: "10000",
        route: { srcChain: "ethereum", dstChain: "base" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "0",
      },
    },
    now: "2026-04-12T11:00:00.000Z",
  });

  const summary = buildForkExecutionSummary({
    plans: [plan],
    submissions: [
      { observedAt: "2026-04-12T11:01:00.000Z", planId: plan.planId, routeLabel: plan.routeLabel, amount: plan.amount, chain: "ethereum", submissionStatus: "submitted", txHash: "0xabc" },
    ],
    receipts: [
      {
        observedAt: "2026-04-12T11:02:00.000Z",
        planId: plan.planId,
        routeLabel: plan.routeLabel,
        amount: plan.amount,
        txHash: "0xabc",
        reconciliationStatus: "pending_output",
        routeContext: plan.routeContext,
        realized: { realizedNetPnlUsd: null, gasDriftUsd: null },
        flags: { failed: false },
      },
    ],
    targetConfirmedCount: 1,
  });

  assert.equal(summary.pendingOutputCount, 1);
  assert.equal(summary.latestPendingOutput.planId, plan.planId);
  assert.match(summary.latestPendingOutput.resolutionCommand, /actual-output-units/);
  assert.equal(summary.latestPendingOutput.outputRequirements.needsOutputAsset, false);
  assert.equal(summary.latestPendingOutput.outputRequirements.needsOutputPriceUsd, false);
  assert.equal(
    summary.latestPendingOutput.resolutionCommand,
    buildForkOutputResolutionCommand(plan, "0xabc"),
  );
});
