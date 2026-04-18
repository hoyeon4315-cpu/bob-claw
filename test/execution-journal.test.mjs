import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildExecutionAttemptEvent,
  buildExecutionBlockedEvent,
  buildExecutionFundingSnapshotEvent,
  buildExecutionFundingOutcomeEvent,
  buildExecutionReconciliationEvent,
  buildExecutionSubmissionEvent,
  canStartExecution,
  latestExecutionEvent,
  stableSerialize,
} from "../src/execution/journal.mjs";

function jobFixture() {
  return {
    jobId: "job-123",
    chain: "bob",
    type: "refill_native",
    asset: "ETH",
    token: "0x0000000000000000000000000000000000000000",
    targetAmount: "1000",
    targetAmountDecimal: 0.001,
    executionMethod: "same_chain_token_to_native_swap",
    resourceKey: "bob:native",
    requiresManualReview: false,
    reviewReasons: [],
    constraints: {
      requireEmergencyStopClear: true,
    },
  };
}

test("execution journal blocks duplicate starts without force", () => {
  const planned = buildExecutionAttemptEvent({
    job: jobFixture(),
    guards: { blocked: false, reasons: [], mode: "dry_run" },
    observedAt: "2026-04-11T05:00:00.000Z",
  });
  const gate = canStartExecution([planned], "job-123");

  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "job_already_dry_run_planned");
});

test("execution journal blocks duplicate planned starts outside dry run", () => {
  const planned = buildExecutionAttemptEvent({
    job: jobFixture(),
    mode: "live",
    guards: { blocked: false, reasons: [], mode: "live" },
    observedAt: "2026-04-11T05:00:00.000Z",
  });
  const gate = canStartExecution([planned], "job-123");

  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "job_already_planned");
});

test("execution journal allows force override", () => {
  const submitted = buildExecutionSubmissionEvent({
    job: jobFixture(),
    txHash: "0xabc",
    observedAt: "2026-04-11T05:01:00.000Z",
  });
  const gate = canStartExecution([submitted], "job-123", { force: true });

  assert.equal(gate.ok, true);
  assert.equal(gate.reason, "force_override");
});

test("execution reconciliation maps receipt outcomes into journal statuses", () => {
  const confirmed = buildExecutionReconciliationEvent({
    job: jobFixture(),
    txHash: "0xabc",
    receiptRecord: {
      reconciliationStatus: "reconciled",
      realized: { actualKnownCostUsd: 0.1 },
      flags: { failed: false },
    },
  });
  const failed = buildExecutionReconciliationEvent({
    job: jobFixture(),
    txHash: "0xdef",
    receiptRecord: {
      reconciliationStatus: "failed",
      realized: { actualKnownCostUsd: 0.2 },
      flags: { failed: true },
    },
  });

  assert.equal(confirmed.status, "confirmed");
  assert.equal(failed.status, "failed");
});

test("latest execution event returns the newest event for a job", () => {
  const older = buildExecutionAttemptEvent({
    job: jobFixture(),
    guards: { blocked: false, reasons: [], mode: "dry_run" },
    observedAt: "2026-04-11T05:00:00.000Z",
  });
  const newer = buildExecutionSubmissionEvent({
    job: jobFixture(),
    txHash: "0xabc",
    observedAt: "2026-04-11T05:05:00.000Z",
  });

  assert.equal(latestExecutionEvent([older, newer], "job-123").status, "submitted");
});

test("execution attempt ids stay stable across object key order", () => {
  const first = buildExecutionAttemptEvent({
    job: { ...jobFixture(), constraints: { requireEmergencyStopClear: true, alpha: 1 } },
    guards: { blocked: false, reasons: [], mode: "dry_run" },
    observedAt: "2026-04-11T05:00:00.000Z",
  });
  const second = buildExecutionAttemptEvent({
    job: { ...jobFixture(), constraints: { alpha: 1, requireEmergencyStopClear: true } },
    guards: { blocked: false, reasons: [], mode: "dry_run" },
    observedAt: "2026-04-11T05:00:00.000Z",
  });

  assert.equal(first.attemptId, second.attemptId);
});

test("blocked execution events preserve blockers and funding-source context", () => {
  const blocked = buildExecutionBlockedEvent({
    job: jobFixture(),
    blockers: ["funding_source_conditional", "cross_chain_source_selection_missing"],
    fundingSource: {
      selectionStatus: "conditional",
      method: "cross_chain_bridge_or_swap",
      missingInputs: ["cross_chain_source_selection_missing"],
    },
    riskDecision: {
      decision: "REVIEW",
      reviews: ["job_requires_manual_review"],
      blockers: [],
    },
    observedAt: "2026-04-11T05:10:00.000Z",
  });

  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.eventType, "execution_attempt_blocked");
  assert.equal(blocked.blockers[0], "funding_source_conditional");
  assert.equal(blocked.fundingSource.method, "cross_chain_bridge_or_swap");
  assert.equal(blocked.riskDecision.decision, "REVIEW");
  assert.deepEqual(blocked.reviewReasons, []);
});

test("funding snapshot events preserve live quote and gas context", () => {
  const event = buildExecutionFundingSnapshotEvent({
    actor: "token_dex_experiment_preview",
    plan: {
      observedAt: "2026-04-18T01:00:00.000Z",
      strategyId: "token-dex-experiment",
      chain: "base",
      planStatus: "ready",
      amount: "10000",
      amountUsd: 12.34,
      slippageBps: 50,
      gasBufferBps: 10000,
      minimumOutputAmount: "9850",
      quote: {
        observedAt: "2026-04-18T01:00:01.000Z",
        provider: "odos",
        source: "token_dex_experiment",
        quoteType: "token_to_token",
        chain: "base",
        pathId: "path-123",
        latencyMs: 111,
        assembleLatencyMs: 55,
        inputToken: "0x1111",
        outputToken: "0x2222",
        inputAmount: "10000",
        outputAmount: "9900",
        inputValueUsd: 12.34,
        outputValueUsd: 12.2,
        netOutputValueUsd: 12.1,
        gasEstimate: 200000,
        gasEstimateValueUsd: 0.03,
        priceImpactPct: 0.1,
        percentDiff: -0.2,
        gweiPerGas: 0.5,
        txTo: "0x3333",
        txGasLimit: "210000",
        txValueWei: "0",
        executionTrust: "verified",
      },
      gasSnapshot: {
        observedAt: "2026-04-18T01:00:02.000Z",
        chain: "base",
        rpcUrl: "https://base-rpc.example",
        blockNumber: 123,
        latencyMs: 12,
        gasPriceWei: "100",
        baseFeeWei: "80",
        priorityFeeWei: "20",
      },
      steps: [{ id: "approve_input_token" }, { id: "swap_input_to_output" }],
    },
  });

  assert.equal(event.status, "context_captured");
  assert.equal(event.eventType, "execution_funding_snapshot");
  assert.equal(event.quote.pathId, "path-123");
  assert.equal(event.gas.gasPriceWei, "100");
  assert.equal(event.slippageBps, 50);
  assert.equal(event.minimumOutputAmount, "9850");
  assert.deepEqual(event.stepIds, ["approve_input_token", "swap_input_to_output"]);
});

test("funding outcome events preserve balances and settlement results", () => {
  const event = buildExecutionFundingOutcomeEvent({
    actor: "token_dex_experiment_execute",
    plan: {
      strategyId: "token-dex-experiment",
      chain: "base",
      outputToken: "0x2222",
      outputAsset: { ticker: "cbBTC" },
      quote: { outputAmount: "9900" },
      minimumOutputAmount: "9850",
    },
    execution: {
      observedAt: "2026-04-18T01:05:00.000Z",
      settlementStatus: "delivered",
      stepResults: [
        { id: "approve_input_token", signerResult: { broadcast: { txHash: "0xaaa" } } },
        { id: "swap_input_to_output", signerResult: { broadcast: { txHash: "0xbbb" } } },
      ],
      sourceBalanceBefore: { balance: 10000n, proofSource: "erc20_balance_delta", rpcUrl: "https://base-rpc.example" },
      sourceBalanceAfter: { balance: 0n, proofSource: "erc20_balance_delta", rpcUrl: "https://base-rpc.example" },
      destinationBalanceBefore: { balance: 0n, proofSource: "erc20_balance_delta", rpcUrl: "https://base-rpc.example" },
      destinationBalanceAfter: { balance: 9900n, proofSource: "erc20_balance_delta", rpcUrl: "https://base-rpc.example" },
      destinationProof: {
        status: "delivered",
        observedDelta: "9900",
        requiredDelta: "9850",
      },
    },
  });

  assert.equal(event.eventType, "execution_funding_outcome");
  assert.equal(event.status, "delivered");
  assert.deepEqual(event.txHashes, ["0xaaa", "0xbbb"]);
  assert.equal(event.sourceBalanceBefore.balance, "10000");
  assert.equal(event.destinationBalanceAfter.balance, "9900");
  assert.equal(event.destinationObservedDelta, "9900");
});

test("stableSerialize preserves undefined values deterministically", () => {
  assert.equal(stableSerialize(undefined), '"__undefined__"');
  assert.equal(stableSerialize([undefined, null]), '["__undefined__",null]');
  assert.equal(stableSerialize({ beta: undefined, alpha: 1 }), '{"alpha":1,"beta":"__undefined__"}');
});
